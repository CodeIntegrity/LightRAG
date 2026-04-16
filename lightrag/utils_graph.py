from __future__ import annotations

import time
import asyncio
import hashlib
import json
import re
from collections.abc import Mapping, Sequence
from difflib import SequenceMatcher
from functools import partial
from typing import Any, cast

import json_repair

from .base import DeletionResult
from .kg.shared_storage import get_storage_keyed_lock
from .constants import GRAPH_FIELD_SEP
from .utils import (
    compute_mdhash_id,
    logger,
    make_relation_vdb_ids,
    remove_think_tags,
)
from .base import StorageNameSpace


_REVISION_TOKEN_EXCLUDED_FIELDS = frozenset(
    {"operation_summary", "revision_token", "vector_data"}
)


class StaleRevisionTokenError(ValueError):
    """Raised when an optimistic concurrency token no longer matches."""


def _stable_json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True)


def _canonicalize_revision_value(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {
            str(key): _canonicalize_revision_value(value[key])
            for key in sorted(value.keys(), key=str)
        }

    if isinstance(value, set):
        value = list(value)

    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        canonical_items = [_canonicalize_revision_value(item) for item in value]
        return sorted(canonical_items, key=_stable_json_dumps)

    if isinstance(value, float) and value.is_integer():
        return int(value)

    return value


def _extract_revision_core_payload(
    payload: Mapping[str, Any] | dict[str, Any],
) -> dict[str, Any]:
    core_keys = ("entity_name", "graph_data", "src_entity", "tgt_entity")
    core_payload = {key: payload[key] for key in core_keys if key in payload}
    if core_payload:
        return core_payload

    return {
        str(key): value
        for key, value in payload.items()
        if key not in _REVISION_TOKEN_EXCLUDED_FIELDS
    }


def build_revision_token(payload: Mapping[str, Any] | dict[str, Any]) -> str:
    """Build a stable optimistic-concurrency token from entity/relation payloads."""

    core_payload = _extract_revision_core_payload(payload)
    canonical_payload = _canonicalize_revision_value(core_payload)
    serialized = _stable_json_dumps(canonical_payload)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _build_entity_revision_payload(
    entity_name: str, node_data: Mapping[str, Any] | None
) -> dict[str, Any]:
    return {"entity_name": entity_name, "graph_data": dict(node_data or {})}


def _build_relation_revision_payload(
    source_entity: str,
    target_entity: str,
    edge_data: Mapping[str, Any] | None,
) -> dict[str, Any]:
    normalized_source, normalized_target = _normalize_relation_endpoints(
        source_entity, target_entity
    )
    return {
        "src_entity": normalized_source,
        "tgt_entity": normalized_target,
        "graph_data": dict(edge_data or {}),
    }


def _validate_expected_revision_token(
    *,
    current_payload: Mapping[str, Any] | dict[str, Any],
    expected_revision_token: str | None,
    object_type: str,
) -> None:
    if not expected_revision_token:
        return

    current_revision_token = build_revision_token(current_payload)
    if current_revision_token != expected_revision_token:
        raise StaleRevisionTokenError(f"Stale {object_type} revision token")


def _normalize_relation_endpoints(
    source_entity: str, target_entity: str
) -> tuple[str, str]:
    if source_entity <= target_entity:
        return source_entity, target_entity
    return target_entity, source_entity


def _normalize_aliases(raw_aliases: Any) -> list[str]:
    if raw_aliases is None:
        return []

    if isinstance(raw_aliases, str):
        candidates = [raw_aliases]
    elif isinstance(raw_aliases, Sequence) and not isinstance(
        raw_aliases, (str, bytes, bytearray)
    ):
        candidates = list(raw_aliases)
    elif isinstance(raw_aliases, set):
        candidates = list(raw_aliases)
    else:
        return []

    normalized_aliases: list[str] = []
    seen_aliases: set[str] = set()

    for candidate in candidates:
        if not isinstance(candidate, str):
            continue
        alias = candidate.strip()
        if alias and alias not in seen_aliases:
            seen_aliases.add(alias)
            normalized_aliases.append(alias)

    return normalized_aliases


def _merge_alias_groups(*alias_groups: Any, exclude: set[str] | None = None) -> list[str]:
    excluded_aliases = exclude or set()
    merged_aliases: list[str] = []
    seen_aliases: set[str] = set()

    for alias_group in alias_groups:
        for alias in _normalize_aliases(alias_group):
            if alias in excluded_aliases or alias in seen_aliases:
                continue
            seen_aliases.add(alias)
            merged_aliases.append(alias)

    return merged_aliases


def _require_non_empty_description(
    description: Any, *, operation: str, object_type: str
) -> None:
    if description is None or not str(description).strip():
        raise ValueError(
            f"{object_type.capitalize()} description cannot be empty for {operation} operation"
        )


async def _persist_graph_updates(
    entities_vdb=None,
    relationships_vdb=None,
    chunk_entity_relation_graph=None,
    entity_chunks_storage=None,
    relation_chunks_storage=None,
) -> None:
    """Unified callback to persist updates after graph operations.

    Ensures all relevant storage instances are properly persisted after
    operations like delete, edit, create, or merge.

    Args:
        entities_vdb: Entity vector database storage (optional)
        relationships_vdb: Relationship vector database storage (optional)
        chunk_entity_relation_graph: Graph storage instance (optional)
        entity_chunks_storage: Entity-chunk tracking storage (optional)
        relation_chunks_storage: Relation-chunk tracking storage (optional)
    """
    storages = []

    # Collect all non-None storage instances
    if entities_vdb is not None:
        storages.append(entities_vdb)
    if relationships_vdb is not None:
        storages.append(relationships_vdb)
    if chunk_entity_relation_graph is not None:
        storages.append(chunk_entity_relation_graph)
    if entity_chunks_storage is not None:
        storages.append(entity_chunks_storage)
    if relation_chunks_storage is not None:
        storages.append(relation_chunks_storage)

    # Persist all storage instances in parallel
    if storages:
        await asyncio.gather(
            *[
                cast(StorageNameSpace, storage_inst).index_done_callback()
                for storage_inst in storages  # type: ignore
            ]
        )


async def adelete_by_entity(
    chunk_entity_relation_graph,
    entities_vdb,
    relationships_vdb,
    entity_name: str,
    entity_chunks_storage=None,
    relation_chunks_storage=None,
) -> DeletionResult:
    """Asynchronously delete an entity and all its relationships.

    Also cleans up entity_chunks_storage and relation_chunks_storage to remove chunk tracking.

    Args:
        chunk_entity_relation_graph: Graph storage instance
        entities_vdb: Vector database storage for entities
        relationships_vdb: Vector database storage for relationships
        entity_name: Name of the entity to delete
        entity_chunks_storage: Optional KV storage for tracking chunks that reference this entity
        relation_chunks_storage: Optional KV storage for tracking chunks that reference relations
    """
    # Use keyed lock for entity to ensure atomic graph and vector db operations
    workspace = entities_vdb.global_config.get("workspace", "")
    namespace = f"{workspace}:GraphDB" if workspace else "GraphDB"
    async with get_storage_keyed_lock(
        [entity_name], namespace=namespace, enable_logging=False
    ):
        try:
            # Check if the entity exists
            if not await chunk_entity_relation_graph.has_node(entity_name):
                logger.warning(f"Entity '{entity_name}' not found.")
                return DeletionResult(
                    status="not_found",
                    doc_id=entity_name,
                    message=f"Entity '{entity_name}' not found.",
                    status_code=404,
                )
            # Retrieve related relationships before deleting the node
            edges = await chunk_entity_relation_graph.get_node_edges(entity_name)
            related_relations_count = len(edges) if edges else 0

            # Clean up chunk tracking storages before deletion
            if entity_chunks_storage is not None:
                # Delete entity's entry from entity_chunks_storage
                await entity_chunks_storage.delete([entity_name])
                logger.info(
                    f"Entity Delete: removed chunk tracking for `{entity_name}`"
                )

            if relation_chunks_storage is not None and edges:
                # Delete all related relationships from relation_chunks_storage
                from .utils import make_relation_chunk_key

                relation_keys_to_delete = []
                for src, tgt in edges:
                    # Normalize entity order for consistent key generation
                    normalized_src, normalized_tgt = sorted([src, tgt])
                    storage_key = make_relation_chunk_key(
                        normalized_src, normalized_tgt
                    )
                    relation_keys_to_delete.append(storage_key)

                if relation_keys_to_delete:
                    await relation_chunks_storage.delete(relation_keys_to_delete)
                    logger.info(
                        f"Entity Delete: removed chunk tracking for {len(relation_keys_to_delete)} relations"
                    )

            await entities_vdb.delete_entity(entity_name)
            await relationships_vdb.delete_entity_relation(entity_name)
            await chunk_entity_relation_graph.delete_node(entity_name)

            message = f"Entity Delete: remove '{entity_name}' and its {related_relations_count} relations"
            logger.info(message)
            await _persist_graph_updates(
                entities_vdb=entities_vdb,
                relationships_vdb=relationships_vdb,
                chunk_entity_relation_graph=chunk_entity_relation_graph,
                entity_chunks_storage=entity_chunks_storage,
                relation_chunks_storage=relation_chunks_storage,
            )
            return DeletionResult(
                status="success",
                doc_id=entity_name,
                message=message,
                status_code=200,
            )
        except Exception as e:
            error_message = f"Error while deleting entity '{entity_name}': {e}"
            logger.error(error_message)
            return DeletionResult(
                status="fail",
                doc_id=entity_name,
                message=error_message,
                status_code=500,
            )


async def adelete_by_relation(
    chunk_entity_relation_graph,
    relationships_vdb,
    source_entity: str,
    target_entity: str,
    relation_chunks_storage=None,
    expected_revision_token: str | None = None,
) -> DeletionResult:
    """Asynchronously delete a relation between two entities.

    Also cleans up relation_chunks_storage to remove chunk tracking.

    Args:
        chunk_entity_relation_graph: Graph storage instance
        relationships_vdb: Vector database storage for relationships
        source_entity: Name of the source entity
        target_entity: Name of the target entity
        relation_chunks_storage: Optional KV storage for tracking chunks that reference this relation
    """
    relation_str = f"{source_entity} -> {target_entity}"
    # Normalize entity order for undirected graph (ensures consistent key generation)
    source_entity, target_entity = _normalize_relation_endpoints(
        source_entity, target_entity
    )

    # Use keyed lock for relation to ensure atomic graph and vector db operations
    workspace = relationships_vdb.global_config.get("workspace", "")
    namespace = f"{workspace}:GraphDB" if workspace else "GraphDB"
    sorted_edge_key = sorted([source_entity, target_entity])
    async with get_storage_keyed_lock(
        sorted_edge_key, namespace=namespace, enable_logging=False
    ):
        try:
            # Check if the relation exists
            edge_exists = await chunk_entity_relation_graph.has_edge(
                source_entity, target_entity
            )
            if not edge_exists:
                message = f"Relation from '{source_entity}' to '{target_entity}' does not exist"
                logger.warning(message)
                return DeletionResult(
                    status="not_found",
                    doc_id=relation_str,
                    message=message,
                    status_code=404,
                )
            edge_data = await chunk_entity_relation_graph.get_edge(
                source_entity, target_entity
            )
            _validate_expected_revision_token(
                current_payload=_build_relation_revision_payload(
                    source_entity, target_entity, edge_data
                ),
                expected_revision_token=expected_revision_token,
                object_type="relation",
            )

            # Clean up chunk tracking storage before deletion
            if relation_chunks_storage is not None:
                from .utils import make_relation_chunk_key

                # Normalize entity order for consistent key generation
                normalized_src, normalized_tgt = sorted([source_entity, target_entity])
                storage_key = make_relation_chunk_key(normalized_src, normalized_tgt)

                await relation_chunks_storage.delete([storage_key])
                logger.info(
                    f"Relation Delete: removed chunk tracking for `{source_entity}`~`{target_entity}`"
                )

            # Delete relation from vector database
            rel_ids_to_delete = [
                compute_mdhash_id(source_entity + target_entity, prefix="rel-"),
                compute_mdhash_id(target_entity + source_entity, prefix="rel-"),
            ]

            await relationships_vdb.delete(rel_ids_to_delete)

            # Delete relation from knowledge graph
            await chunk_entity_relation_graph.remove_edges(
                [(source_entity, target_entity)]
            )

            message = f"Relation Delete: `{source_entity}`~`{target_entity}` deleted successfully"
            logger.info(message)
            await _persist_graph_updates(
                relationships_vdb=relationships_vdb,
                chunk_entity_relation_graph=chunk_entity_relation_graph,
                relation_chunks_storage=relation_chunks_storage,
            )
            return DeletionResult(
                status="success",
                doc_id=relation_str,
                message=message,
                status_code=200,
            )
        except StaleRevisionTokenError as e:
            logger.warning(
                "Relation Delete: stale revision token for `%s`~`%s`",
                source_entity,
                target_entity,
            )
            return DeletionResult(
                status="not_allowed",
                doc_id=relation_str,
                message=str(e),
                status_code=409,
            )
        except Exception as e:
            error_message = f"Error while deleting relation from '{source_entity}' to '{target_entity}': {e}"
            logger.error(error_message)
            return DeletionResult(
                status="fail",
                doc_id=relation_str,
                message=error_message,
                status_code=500,
            )


async def _edit_entity_impl(
    chunk_entity_relation_graph,
    entities_vdb,
    relationships_vdb,
    entity_name: str,
    updated_data: dict[str, str],
    *,
    entity_chunks_storage=None,
    relation_chunks_storage=None,
) -> dict[str, Any]:
    """Internal helper that edits an entity without acquiring storage locks.

    This function performs the actual entity edit operations without lock management.
    It should only be called by public APIs that have already acquired necessary locks.

    Args:
        chunk_entity_relation_graph: Graph storage instance
        entities_vdb: Vector database storage for entities
        relationships_vdb: Vector database storage for relationships
        entity_name: Name of the entity to edit
        updated_data: Dictionary containing updated attributes (including optional entity_name for renaming)
        entity_chunks_storage: Optional KV storage for tracking chunks
        relation_chunks_storage: Optional KV storage for tracking relation chunks

    Returns:
        Dictionary containing updated entity information

    Note:
        Caller must acquire appropriate locks before calling this function.
        If renaming (entity_name in updated_data), this function will check if the new name exists.
    """
    new_entity_name = updated_data.get("entity_name", entity_name)
    is_renaming = new_entity_name != entity_name

    original_entity_name = entity_name

    node_exists = await chunk_entity_relation_graph.has_node(entity_name)
    if not node_exists:
        raise ValueError(f"Entity '{entity_name}' does not exist")
    node_data = await chunk_entity_relation_graph.get_node(entity_name)

    if is_renaming:
        existing_node = await chunk_entity_relation_graph.has_node(new_entity_name)
        if existing_node:
            raise ValueError(
                f"Entity name '{new_entity_name}' already exists, cannot rename"
            )

    new_node_data = {**node_data, **updated_data}
    new_node_data["entity_id"] = new_entity_name
    if is_renaming and "name" not in updated_data:
        new_node_data["name"] = new_entity_name

    if "entity_name" in new_node_data:
        del new_node_data[
            "entity_name"
        ]  # Node data should not contain entity_name field

    if is_renaming:
        logger.info(f"Entity Edit: renaming `{entity_name}` to `{new_entity_name}`")

        await chunk_entity_relation_graph.upsert_node(new_entity_name, new_node_data)

        relations_to_update = []
        relations_to_delete = []
        edges = await chunk_entity_relation_graph.get_node_edges(entity_name)
        if edges:
            for source, target in edges:
                edge_data = await chunk_entity_relation_graph.get_edge(source, target)
                if edge_data:
                    relations_to_delete.append(
                        compute_mdhash_id(source + target, prefix="rel-")
                    )
                    relations_to_delete.append(
                        compute_mdhash_id(target + source, prefix="rel-")
                    )
                    if source == entity_name:
                        await chunk_entity_relation_graph.upsert_edge(
                            new_entity_name, target, edge_data
                        )
                        relations_to_update.append((new_entity_name, target, edge_data))
                    else:  # target == entity_name
                        await chunk_entity_relation_graph.upsert_edge(
                            source, new_entity_name, edge_data
                        )
                        relations_to_update.append((source, new_entity_name, edge_data))

        await chunk_entity_relation_graph.delete_node(entity_name)

        old_entity_id = compute_mdhash_id(entity_name, prefix="ent-")
        await entities_vdb.delete([old_entity_id])

        await relationships_vdb.delete(relations_to_delete)

        for src, tgt, edge_data in relations_to_update:
            normalized_src, normalized_tgt = sorted([src, tgt])

            description = edge_data.get("description", "")
            keywords = edge_data.get("keywords", "")
            source_id = edge_data.get("source_id", "")
            weight = float(edge_data.get("weight", 1.0))

            content = f"{normalized_src}\t{normalized_tgt}\n{keywords}\n{description}"

            relation_id = compute_mdhash_id(
                normalized_src + normalized_tgt, prefix="rel-"
            )

            relation_data = {
                relation_id: {
                    "content": content,
                    "src_id": normalized_src,
                    "tgt_id": normalized_tgt,
                    "source_id": source_id,
                    "description": description,
                    "keywords": keywords,
                    "weight": weight,
                }
            }

            await relationships_vdb.upsert(relation_data)

        entity_name = new_entity_name
    else:
        await chunk_entity_relation_graph.upsert_node(entity_name, new_node_data)

    description = new_node_data.get("description", "")
    source_id = new_node_data.get("source_id", "")
    entity_type = new_node_data.get("entity_type", "")
    content = entity_name + "\n" + description

    entity_id = compute_mdhash_id(entity_name, prefix="ent-")

    entity_data = {
        entity_id: {
            "content": content,
            "entity_name": entity_name,
            "source_id": source_id,
            "description": description,
            "entity_type": entity_type,
        }
    }

    await entities_vdb.upsert(entity_data)

    if entity_chunks_storage is not None or relation_chunks_storage is not None:
        from .utils import make_relation_chunk_key, compute_incremental_chunk_ids

        if entity_chunks_storage is not None:
            storage_key = original_entity_name if is_renaming else entity_name
            stored_data = await entity_chunks_storage.get_by_id(storage_key)
            has_stored_data = (
                stored_data
                and isinstance(stored_data, dict)
                and stored_data.get("chunk_ids")
            )

            old_source_id = node_data.get("source_id", "")
            old_chunk_ids = [cid for cid in old_source_id.split(GRAPH_FIELD_SEP) if cid]

            new_source_id = new_node_data.get("source_id", "")
            new_chunk_ids = [cid for cid in new_source_id.split(GRAPH_FIELD_SEP) if cid]

            source_id_changed = set(new_chunk_ids) != set(old_chunk_ids)

            if source_id_changed or not has_stored_data or is_renaming:
                existing_full_chunk_ids = []
                if has_stored_data:
                    existing_full_chunk_ids = [
                        cid for cid in stored_data.get("chunk_ids", []) if cid
                    ]

                if not existing_full_chunk_ids:
                    existing_full_chunk_ids = old_chunk_ids.copy()

                updated_chunk_ids = compute_incremental_chunk_ids(
                    existing_full_chunk_ids, old_chunk_ids, new_chunk_ids
                )

                if is_renaming:
                    await entity_chunks_storage.delete([original_entity_name])
                    await entity_chunks_storage.upsert(
                        {
                            entity_name: {
                                "chunk_ids": updated_chunk_ids,
                                "count": len(updated_chunk_ids),
                            }
                        }
                    )
                else:
                    await entity_chunks_storage.upsert(
                        {
                            entity_name: {
                                "chunk_ids": updated_chunk_ids,
                                "count": len(updated_chunk_ids),
                            }
                        }
                    )

                logger.info(
                    f"Entity Edit: find {len(updated_chunk_ids)} chunks related to `{entity_name}`"
                )

        if is_renaming and relation_chunks_storage is not None and relations_to_update:
            for src, tgt, edge_data in relations_to_update:
                old_src = original_entity_name if src == entity_name else src
                old_tgt = original_entity_name if tgt == entity_name else tgt

                old_normalized_src, old_normalized_tgt = sorted([old_src, old_tgt])
                new_normalized_src, new_normalized_tgt = sorted([src, tgt])

                old_storage_key = make_relation_chunk_key(
                    old_normalized_src, old_normalized_tgt
                )
                new_storage_key = make_relation_chunk_key(
                    new_normalized_src, new_normalized_tgt
                )

                if old_storage_key != new_storage_key:
                    old_stored_data = await relation_chunks_storage.get_by_id(
                        old_storage_key
                    )
                    relation_chunk_ids = []

                    if old_stored_data and isinstance(old_stored_data, dict):
                        relation_chunk_ids = [
                            cid for cid in old_stored_data.get("chunk_ids", []) if cid
                        ]
                    else:
                        relation_source_id = edge_data.get("source_id", "")
                        relation_chunk_ids = [
                            cid
                            for cid in relation_source_id.split(GRAPH_FIELD_SEP)
                            if cid
                        ]

                    await relation_chunks_storage.delete([old_storage_key])

                    if relation_chunk_ids:
                        await relation_chunks_storage.upsert(
                            {
                                new_storage_key: {
                                    "chunk_ids": relation_chunk_ids,
                                    "count": len(relation_chunk_ids),
                                }
                            }
                        )
            logger.info(
                f"Entity Edit: migrate {len(relations_to_update)} relations after rename"
            )

    await _persist_graph_updates(
        entities_vdb=entities_vdb,
        relationships_vdb=relationships_vdb,
        chunk_entity_relation_graph=chunk_entity_relation_graph,
        entity_chunks_storage=entity_chunks_storage,
        relation_chunks_storage=relation_chunks_storage,
    )

    logger.info(f"Entity Edit: `{entity_name}` successfully updated")
    return await get_entity_info(
        chunk_entity_relation_graph,
        entities_vdb,
        entity_name,
        include_vector_data=True,
    )


async def aedit_entity(
    chunk_entity_relation_graph,
    entities_vdb,
    relationships_vdb,
    entity_name: str,
    updated_data: dict[str, str],
    allow_rename: bool = True,
    allow_merge: bool = False,
    entity_chunks_storage=None,
    relation_chunks_storage=None,
    expected_revision_token: str | None = None,
) -> dict[str, Any]:
    """Asynchronously edit entity information.

    Updates entity information in the knowledge graph and re-embeds the entity in the vector database.
    Also synchronizes entity_chunks_storage and relation_chunks_storage to track chunk references.

    Args:
        chunk_entity_relation_graph: Graph storage instance
        entities_vdb: Vector database storage for entities
        relationships_vdb: Vector database storage for relationships
        entity_name: Name of the entity to edit
        updated_data: Dictionary containing updated attributes, e.g. {"description": "new description", "entity_type": "new type"}
        allow_rename: Whether to allow entity renaming, defaults to True
        allow_merge: Whether to merge into an existing entity when renaming to an existing name, defaults to False
        entity_chunks_storage: Optional KV storage for tracking chunks that reference this entity
        relation_chunks_storage: Optional KV storage for tracking chunks that reference relations

    Returns:
        Dictionary containing updated entity information and operation summary with the following structure:
        {
            "entity_name": str,           # Name of the entity
            "description": str,           # Entity description
            "entity_type": str,           # Entity type
            "source_id": str,            # Source chunk IDs
            ...                          # Other entity properties
            "operation_summary": {
                "merged": bool,          # Whether entity was merged
                "merge_status": str,     # "success" | "failed" | "not_attempted"
                "merge_error": str | None,  # Error message if merge failed
                "operation_status": str, # "success" | "partial_success" | "failure"
                "target_entity": str | None,  # Target entity name if renaming/merging
                "final_entity": str,     # Final entity name after operation
                "renamed": bool          # Whether entity was renamed
            }
        }

        operation_status values:
            - "success": Operation completed successfully (update/rename/merge all succeeded)
            - "partial_success": Non-name updates succeeded but merge failed
            - "failure": Operation failed completely

        merge_status values:
            - "success": Entity successfully merged into target
            - "failed": Merge operation failed
            - "not_attempted": No merge was attempted (normal update/rename)
    """
    if "description" in updated_data:
        _require_non_empty_description(
            updated_data.get("description"), operation="edit", object_type="entity"
        )

    new_entity_name = updated_data.get("entity_name", entity_name)
    is_renaming = new_entity_name != entity_name

    lock_keys = sorted({entity_name, new_entity_name}) if is_renaming else [entity_name]

    workspace = entities_vdb.global_config.get("workspace", "")
    namespace = f"{workspace}:GraphDB" if workspace else "GraphDB"

    operation_summary: dict[str, Any] = {
        "merged": False,
        "merge_status": "not_attempted",
        "merge_error": None,
        "operation_status": "success",
        "target_entity": None,
        "final_entity": new_entity_name if is_renaming else entity_name,
        "renamed": is_renaming,
    }
    async with get_storage_keyed_lock(
        lock_keys, namespace=namespace, enable_logging=False
    ):
        try:
            if expected_revision_token:
                current_node_data = await chunk_entity_relation_graph.get_node(
                    entity_name
                )
                if current_node_data is None:
                    raise ValueError(f"Entity '{entity_name}' does not exist")
                _validate_expected_revision_token(
                    current_payload=_build_entity_revision_payload(
                        entity_name, current_node_data
                    ),
                    expected_revision_token=expected_revision_token,
                    object_type="entity",
                )

            if is_renaming and not allow_rename:
                raise ValueError(
                    "Entity renaming is not allowed. Set allow_rename=True to enable this feature"
                )

            if is_renaming:
                target_exists = await chunk_entity_relation_graph.has_node(
                    new_entity_name
                )
                if target_exists:
                    if not allow_merge:
                        raise ValueError(
                            f"Entity name '{new_entity_name}' already exists, cannot rename"
                        )

                    logger.info(
                        f"Entity Edit: `{entity_name}` will be merged into `{new_entity_name}`"
                    )

                    # Track whether non-name updates were applied
                    non_name_updates_applied = False
                    non_name_updates = {
                        key: value
                        for key, value in updated_data.items()
                        if key != "entity_name"
                    }

                    # Apply non-name updates first
                    if non_name_updates:
                        try:
                            logger.info(
                                "Entity Edit: applying non-name updates before merge"
                            )
                            await _edit_entity_impl(
                                chunk_entity_relation_graph,
                                entities_vdb,
                                relationships_vdb,
                                entity_name,
                                non_name_updates,
                                entity_chunks_storage=entity_chunks_storage,
                                relation_chunks_storage=relation_chunks_storage,
                            )
                            non_name_updates_applied = True
                        except Exception as update_error:
                            # If update fails, re-raise immediately
                            logger.error(
                                f"Entity Edit: non-name updates failed: {update_error}"
                            )
                            raise

                    # Attempt to merge entities
                    try:
                        merge_result = await _merge_entities_impl(
                            chunk_entity_relation_graph,
                            entities_vdb,
                            relationships_vdb,
                            [entity_name],
                            new_entity_name,
                            merge_strategy=None,
                            target_entity_data=None,
                            entity_chunks_storage=entity_chunks_storage,
                            relation_chunks_storage=relation_chunks_storage,
                        )

                        # Merge succeeded
                        operation_summary.update(
                            {
                                "merged": True,
                                "merge_status": "success",
                                "merge_error": None,
                                "operation_status": "success",
                                "target_entity": new_entity_name,
                                "final_entity": new_entity_name,
                            }
                        )
                        return {**merge_result, "operation_summary": operation_summary}

                    except Exception as merge_error:
                        # Merge failed, but update may have succeeded
                        logger.error(f"Entity Edit: merge failed: {merge_error}")

                        # Return partial success status (update succeeded but merge failed)
                        operation_summary.update(
                            {
                                "merged": False,
                                "merge_status": "failed",
                                "merge_error": str(merge_error),
                                "operation_status": "partial_success"
                                if non_name_updates_applied
                                else "failure",
                                "target_entity": new_entity_name,
                                "final_entity": entity_name,  # Keep source entity name
                            }
                        )

                        # Get current entity info (with applied updates if any)
                        entity_info = await get_entity_info(
                            chunk_entity_relation_graph,
                            entities_vdb,
                            entity_name,
                            include_vector_data=True,
                        )
                        return {**entity_info, "operation_summary": operation_summary}

            # Normal edit flow (no merge involved)
            edit_result = await _edit_entity_impl(
                chunk_entity_relation_graph,
                entities_vdb,
                relationships_vdb,
                entity_name,
                updated_data,
                entity_chunks_storage=entity_chunks_storage,
                relation_chunks_storage=relation_chunks_storage,
            )
            operation_summary["operation_status"] = "success"
            return {**edit_result, "operation_summary": operation_summary}

        except Exception as e:
            logger.error(f"Error while editing entity '{entity_name}': {e}")
            raise


async def aedit_relation(
    chunk_entity_relation_graph,
    entities_vdb,
    relationships_vdb,
    source_entity: str,
    target_entity: str,
    updated_data: dict[str, Any],
    relation_chunks_storage=None,
    expected_revision_token: str | None = None,
) -> dict[str, Any]:
    """Asynchronously edit relation information.

    Updates relation (edge) information in the knowledge graph and re-embeds the relation in the vector database.
    Also synchronizes the relation_chunks_storage to track which chunks reference this relation.

    Args:
        chunk_entity_relation_graph: Graph storage instance
        entities_vdb: Vector database storage for entities
        relationships_vdb: Vector database storage for relationships
        source_entity: Name of the source entity
        target_entity: Name of the target entity
        updated_data: Dictionary containing updated attributes, e.g. {"description": "new description", "keywords": "new keywords"}
        relation_chunks_storage: Optional KV storage for tracking chunks that reference this relation

    Returns:
        Dictionary containing updated relation information
    """
    if "description" in updated_data:
        _require_non_empty_description(
            updated_data.get("description"), operation="edit", object_type="relation"
        )

    # Normalize entity order for undirected graph (ensures consistent key generation)
    source_entity, target_entity = _normalize_relation_endpoints(
        source_entity, target_entity
    )

    # Use keyed lock for relation to ensure atomic graph and vector db operations
    workspace = relationships_vdb.global_config.get("workspace", "")
    namespace = f"{workspace}:GraphDB" if workspace else "GraphDB"
    sorted_edge_key = sorted([source_entity, target_entity])
    async with get_storage_keyed_lock(
        sorted_edge_key, namespace=namespace, enable_logging=False
    ):
        try:
            # 1. Get current relation information
            edge_exists = await chunk_entity_relation_graph.has_edge(
                source_entity, target_entity
            )
            if not edge_exists:
                raise ValueError(
                    f"Relation from '{source_entity}' to '{target_entity}' does not exist"
                )
            edge_data = await chunk_entity_relation_graph.get_edge(
                source_entity, target_entity
            )
            _validate_expected_revision_token(
                current_payload=_build_relation_revision_payload(
                    source_entity, target_entity, edge_data
                ),
                expected_revision_token=expected_revision_token,
                object_type="relation",
            )
            # Important: First delete the old relation record from the vector database
            # Delete both permutations to handle relationships created before normalization
            rel_ids_to_delete = [
                compute_mdhash_id(source_entity + target_entity, prefix="rel-"),
                compute_mdhash_id(target_entity + source_entity, prefix="rel-"),
            ]
            await relationships_vdb.delete(rel_ids_to_delete)
            logger.debug(
                f"Relation Delete: delete vdb for `{source_entity}`~`{target_entity}`"
            )

            # 2. Update relation information in the graph
            new_edge_data = {**edge_data, **updated_data}
            await chunk_entity_relation_graph.upsert_edge(
                source_entity, target_entity, new_edge_data
            )

            # 3. Recalculate relation's vector representation and update vector database
            description = new_edge_data.get("description", "")
            keywords = new_edge_data.get("keywords", "")
            source_id = new_edge_data.get("source_id", "")
            weight = float(new_edge_data.get("weight", 1.0))

            # Create content for embedding
            content = f"{source_entity}\t{target_entity}\n{keywords}\n{description}"

            # Calculate relation ID
            relation_id = compute_mdhash_id(
                source_entity + target_entity, prefix="rel-"
            )

            # Prepare data for vector database update
            relation_data = {
                relation_id: {
                    "content": content,
                    "src_id": source_entity,
                    "tgt_id": target_entity,
                    "source_id": source_id,
                    "description": description,
                    "keywords": keywords,
                    "weight": weight,
                }
            }

            # Update vector database
            await relationships_vdb.upsert(relation_data)

            # 4. Update relation_chunks_storage in two scenarios:
            #    - source_id has changed (edit scenario)
            #    - relation_chunks_storage has no existing data (migration/initialization scenario)
            if relation_chunks_storage is not None:
                from .utils import (
                    make_relation_chunk_key,
                    compute_incremental_chunk_ids,
                )

                storage_key = make_relation_chunk_key(source_entity, target_entity)

                # Check if storage has existing data
                stored_data = await relation_chunks_storage.get_by_id(storage_key)
                has_stored_data = (
                    stored_data
                    and isinstance(stored_data, dict)
                    and stored_data.get("chunk_ids")
                )

                # Get old and new source_id
                old_source_id = edge_data.get("source_id", "")
                old_chunk_ids = [
                    cid for cid in old_source_id.split(GRAPH_FIELD_SEP) if cid
                ]

                new_source_id = new_edge_data.get("source_id", "")
                new_chunk_ids = [
                    cid for cid in new_source_id.split(GRAPH_FIELD_SEP) if cid
                ]

                source_id_changed = set(new_chunk_ids) != set(old_chunk_ids)

                # Update if: source_id changed OR storage has no data
                if source_id_changed or not has_stored_data:
                    # Get existing full chunk_ids from storage
                    existing_full_chunk_ids = []
                    if has_stored_data:
                        existing_full_chunk_ids = [
                            cid for cid in stored_data.get("chunk_ids", []) if cid
                        ]

                    # If no stored data exists, use old source_id as baseline
                    if not existing_full_chunk_ids:
                        existing_full_chunk_ids = old_chunk_ids.copy()

                    # Use utility function to compute incremental updates
                    updated_chunk_ids = compute_incremental_chunk_ids(
                        existing_full_chunk_ids, old_chunk_ids, new_chunk_ids
                    )

                    # Update storage (Update even if updated_chunk_ids is empty)
                    await relation_chunks_storage.upsert(
                        {
                            storage_key: {
                                "chunk_ids": updated_chunk_ids,
                                "count": len(updated_chunk_ids),
                            }
                        }
                    )

                    logger.info(
                        f"Relation Delete: update chunk tracking for `{source_entity}`~`{target_entity}`"
                    )

            # 5. Save changes
            await _persist_graph_updates(
                relationships_vdb=relationships_vdb,
                chunk_entity_relation_graph=chunk_entity_relation_graph,
                relation_chunks_storage=relation_chunks_storage,
            )

            logger.info(
                f"Relation Delete: `{source_entity}`~`{target_entity}`' successfully updated"
            )
            return await get_relation_info(
                chunk_entity_relation_graph,
                relationships_vdb,
                source_entity,
                target_entity,
                include_vector_data=True,
            )
        except Exception as e:
            logger.error(
                f"Error while editing relation from '{source_entity}' to '{target_entity}': {e}"
            )
            raise


async def acreate_entity(
    chunk_entity_relation_graph,
    entities_vdb,
    relationships_vdb,
    entity_name: str,
    entity_data: dict[str, Any],
    entity_chunks_storage=None,
    relation_chunks_storage=None,
) -> dict[str, Any]:
    """Asynchronously create a new entity.

    Creates a new entity in the knowledge graph and adds it to the vector database.
    Also synchronizes entity_chunks_storage to track chunk references.

    Args:
        chunk_entity_relation_graph: Graph storage instance
        entities_vdb: Vector database storage for entities
        relationships_vdb: Vector database storage for relationships
        entity_name: Name of the new entity
        entity_data: Dictionary containing entity attributes, e.g. {"description": "description", "entity_type": "type"}
        entity_chunks_storage: Optional KV storage for tracking chunks that reference this entity
        relation_chunks_storage: Optional KV storage for tracking chunks that reference relations

    Returns:
        Dictionary containing created entity information
    """
    _require_non_empty_description(
        entity_data.get("description"), operation="create", object_type="entity"
    )

    # Use keyed lock for entity to ensure atomic graph and vector db operations
    workspace = entities_vdb.global_config.get("workspace", "")
    namespace = f"{workspace}:GraphDB" if workspace else "GraphDB"
    async with get_storage_keyed_lock(
        [entity_name], namespace=namespace, enable_logging=False
    ):
        try:
            # Check if entity already exists
            existing_node = await chunk_entity_relation_graph.has_node(entity_name)
            if existing_node:
                raise ValueError(f"Entity '{entity_name}' already exists")

            # Prepare node data with defaults if missing
            node_data = {
                "entity_id": entity_name,
                "entity_type": entity_data.get("entity_type", "UNKNOWN"),
                "description": entity_data.get("description", ""),
                "source_id": entity_data.get("source_id", "manual_creation"),
                "file_path": entity_data.get("file_path", "manual_creation"),
                "created_at": int(time.time()),
            }

            # Add entity to knowledge graph
            await chunk_entity_relation_graph.upsert_node(entity_name, node_data)

            # Prepare content for entity
            description = node_data.get("description", "")
            source_id = node_data.get("source_id", "")
            entity_type = node_data.get("entity_type", "")
            content = entity_name + "\n" + description

            # Calculate entity ID
            entity_id = compute_mdhash_id(entity_name, prefix="ent-")

            # Prepare data for vector database update
            entity_data_for_vdb = {
                entity_id: {
                    "content": content,
                    "entity_name": entity_name,
                    "source_id": source_id,
                    "description": description,
                    "entity_type": entity_type,
                    "file_path": entity_data.get("file_path", "manual_creation"),
                }
            }

            # Update vector database
            await entities_vdb.upsert(entity_data_for_vdb)

            # Update entity_chunks_storage to track chunk references
            if entity_chunks_storage is not None:
                source_id = node_data.get("source_id", "")
                chunk_ids = [cid for cid in source_id.split(GRAPH_FIELD_SEP) if cid]

                if chunk_ids:
                    await entity_chunks_storage.upsert(
                        {
                            entity_name: {
                                "chunk_ids": chunk_ids,
                                "count": len(chunk_ids),
                            }
                        }
                    )
                    logger.info(
                        f"Entity Create: tracked {len(chunk_ids)} chunks for `{entity_name}`"
                    )

            # Save changes
            await _persist_graph_updates(
                entities_vdb=entities_vdb,
                relationships_vdb=relationships_vdb,
                chunk_entity_relation_graph=chunk_entity_relation_graph,
                entity_chunks_storage=entity_chunks_storage,
                relation_chunks_storage=relation_chunks_storage,
            )

            logger.info(f"Entity Create: '{entity_name}' successfully created")
            return await get_entity_info(
                chunk_entity_relation_graph,
                entities_vdb,
                entity_name,
                include_vector_data=True,
            )
        except Exception as e:
            logger.error(f"Error while creating entity '{entity_name}': {e}")
            raise


async def acreate_relation(
    chunk_entity_relation_graph,
    entities_vdb,
    relationships_vdb,
    source_entity: str,
    target_entity: str,
    relation_data: dict[str, Any],
    relation_chunks_storage=None,
) -> dict[str, Any]:
    """Asynchronously create a new relation between entities.

    Creates a new relation (edge) in the knowledge graph and adds it to the vector database.
    Also synchronizes relation_chunks_storage to track chunk references.

    Args:
        chunk_entity_relation_graph: Graph storage instance
        entities_vdb: Vector database storage for entities
        relationships_vdb: Vector database storage for relationships
        source_entity: Name of the source entity
        target_entity: Name of the target entity
        relation_data: Dictionary containing relation attributes, e.g. {"description": "description", "keywords": "keywords"}
        relation_chunks_storage: Optional KV storage for tracking chunks that reference this relation

    Returns:
        Dictionary containing created relation information
    """
    _require_non_empty_description(
        relation_data.get("description"), operation="create", object_type="relation"
    )

    # Use keyed lock for relation to ensure atomic graph and vector db operations
    workspace = relationships_vdb.global_config.get("workspace", "")
    namespace = f"{workspace}:GraphDB" if workspace else "GraphDB"
    sorted_edge_key = sorted([source_entity, target_entity])
    async with get_storage_keyed_lock(
        sorted_edge_key, namespace=namespace, enable_logging=False
    ):
        try:
            # Check if both entities exist
            source_exists = await chunk_entity_relation_graph.has_node(source_entity)
            target_exists = await chunk_entity_relation_graph.has_node(target_entity)

            if not source_exists:
                raise ValueError(f"Source entity '{source_entity}' does not exist")
            if not target_exists:
                raise ValueError(f"Target entity '{target_entity}' does not exist")

            # Check if relation already exists
            existing_edge = await chunk_entity_relation_graph.has_edge(
                source_entity, target_entity
            )
            if existing_edge:
                raise ValueError(
                    f"Relation from '{source_entity}' to '{target_entity}' already exists"
                )

            # Prepare edge data with defaults if missing
            edge_data = {
                "description": relation_data.get("description", ""),
                "keywords": relation_data.get("keywords", ""),
                "source_id": relation_data.get("source_id", "manual_creation"),
                "weight": float(relation_data.get("weight", 1.0)),
                "file_path": relation_data.get("file_path", "manual_creation"),
                "created_at": int(time.time()),
            }

            # Add relation to knowledge graph
            await chunk_entity_relation_graph.upsert_edge(
                source_entity, target_entity, edge_data
            )

            # Normalize entity order for undirected relation vector (ensures consistent key generation)
            if source_entity > target_entity:
                source_entity, target_entity = target_entity, source_entity

            # Prepare content for embedding
            description = edge_data.get("description", "")
            keywords = edge_data.get("keywords", "")
            source_id = edge_data.get("source_id", "")
            weight = edge_data.get("weight", 1.0)

            # Create content for embedding
            content = f"{keywords}\t{source_entity}\n{target_entity}\n{description}"

            # Calculate relation ID
            relation_id = compute_mdhash_id(
                source_entity + target_entity, prefix="rel-"
            )

            # Prepare data for vector database update
            relation_data_for_vdb = {
                relation_id: {
                    "content": content,
                    "src_id": source_entity,
                    "tgt_id": target_entity,
                    "source_id": source_id,
                    "description": description,
                    "keywords": keywords,
                    "weight": weight,
                    "file_path": relation_data.get("file_path", "manual_creation"),
                }
            }

            # Update vector database
            await relationships_vdb.upsert(relation_data_for_vdb)

            # Update relation_chunks_storage to track chunk references
            if relation_chunks_storage is not None:
                from .utils import make_relation_chunk_key

                # Normalize entity order for consistent key generation
                normalized_src, normalized_tgt = sorted([source_entity, target_entity])
                storage_key = make_relation_chunk_key(normalized_src, normalized_tgt)

                source_id = edge_data.get("source_id", "")
                chunk_ids = [cid for cid in source_id.split(GRAPH_FIELD_SEP) if cid]

                if chunk_ids:
                    await relation_chunks_storage.upsert(
                        {
                            storage_key: {
                                "chunk_ids": chunk_ids,
                                "count": len(chunk_ids),
                            }
                        }
                    )
                    logger.info(
                        f"Relation Create: tracked {len(chunk_ids)} chunks for `{source_entity}`~`{target_entity}`"
                    )

            # Save changes
            await _persist_graph_updates(
                relationships_vdb=relationships_vdb,
                chunk_entity_relation_graph=chunk_entity_relation_graph,
                relation_chunks_storage=relation_chunks_storage,
            )

            logger.info(
                f"Relation Create: `{source_entity}`~`{target_entity}` successfully created"
            )
            return await get_relation_info(
                chunk_entity_relation_graph,
                relationships_vdb,
                source_entity,
                target_entity,
                include_vector_data=True,
            )
        except Exception as e:
            logger.error(
                f"Error while creating relation from '{source_entity}' to '{target_entity}': {e}"
            )
            raise


async def _merge_entities_impl(
    chunk_entity_relation_graph,
    entities_vdb,
    relationships_vdb,
    source_entities: list[str],
    target_entity: str,
    *,
    merge_strategy: dict[str, str] = None,
    target_entity_data: dict[str, Any] = None,
    entity_chunks_storage=None,
    relation_chunks_storage=None,
) -> dict[str, Any]:
    """Internal helper that merges entities without acquiring storage locks.

    This function performs the actual entity merge operations without lock management.
    It should only be called by public APIs that have already acquired necessary locks.

    Args:
        chunk_entity_relation_graph: Graph storage instance
        entities_vdb: Vector database storage for entities
        relationships_vdb: Vector database storage for relationships
        source_entities: List of source entity names to merge
        target_entity: Name of the target entity after merging
        merge_strategy: Deprecated. Merge strategy for each field (optional)
        target_entity_data: Dictionary of specific values to set for target entity (optional)
        entity_chunks_storage: Optional KV storage for tracking chunks
        relation_chunks_storage: Optional KV storage for tracking relation chunks

    Returns:
        Dictionary containing the merged entity information

    Note:
        Caller must acquire appropriate locks before calling this function.
        All source entities and the target entity should be locked together.
    """
    # Default merge strategy for entities
    default_entity_merge_strategy = {
        "description": "concatenate",
        "entity_type": "keep_first",
        "source_id": "join_unique",
        "file_path": "join_unique",
    }
    effective_entity_merge_strategy = default_entity_merge_strategy
    if merge_strategy:
        logger.warning(
            "Entity Merge: merge_strategy parameter is deprecated and will be ignored in a future release."
        )
        effective_entity_merge_strategy = {
            **default_entity_merge_strategy,
            **merge_strategy,
        }
    target_entity_data = {} if target_entity_data is None else target_entity_data

    # 1. Check if all source entities exist
    source_entities_data = {}
    for entity_name in source_entities:
        node_exists = await chunk_entity_relation_graph.has_node(entity_name)
        if not node_exists:
            raise ValueError(f"Source entity '{entity_name}' does not exist")
        node_data = await chunk_entity_relation_graph.get_node(entity_name)
        source_entities_data[entity_name] = node_data

    # 2. Check if target entity exists and get its data if it does
    target_exists = await chunk_entity_relation_graph.has_node(target_entity)
    existing_target_entity_data = {}
    if target_exists:
        existing_target_entity_data = await chunk_entity_relation_graph.get_node(
            target_entity
        )

    # 3. Merge entity data
    merged_entity_data = _merge_attributes(
        list(source_entities_data.values())
        + ([existing_target_entity_data] if target_exists else []),
        effective_entity_merge_strategy,
        filter_none_only=False,  # Use entity behavior: filter falsy values
    )

    # Apply any explicitly provided target entity data (overrides merged data)
    for key, value in target_entity_data.items():
        merged_entity_data[key] = value

    merged_aliases = _merge_alias_groups(
        existing_target_entity_data.get("aliases"),
        target_entity_data.get("aliases"),
        source_entities,
        *(
            source_entity_data.get("aliases")
            for source_entity_data in source_entities_data.values()
        ),
        exclude={target_entity},
    )
    if merged_aliases:
        merged_entity_data["aliases"] = merged_aliases

    # 4. Get all relationships of the source entities and target entity (if exists)
    all_relations = []
    entities_to_collect = source_entities.copy()

    # If target entity exists and not already in source_entities, add it
    if target_exists and target_entity not in source_entities:
        entities_to_collect.append(target_entity)

    for entity_name in entities_to_collect:
        # Get all relationships of the entities
        edges = await chunk_entity_relation_graph.get_node_edges(entity_name)
        if edges:
            for src, tgt in edges:
                # Ensure src is the current entity
                if src == entity_name:
                    edge_data = await chunk_entity_relation_graph.get_edge(src, tgt)
                    all_relations.append((src, tgt, edge_data))

    # 5. Create or update the target entity
    merged_entity_data["entity_id"] = target_entity
    if "name" not in target_entity_data:
        merged_entity_data["name"] = target_entity
    if not target_exists:
        await chunk_entity_relation_graph.upsert_node(target_entity, merged_entity_data)
        logger.info(f"Entity Merge: created target '{target_entity}'")
    else:
        await chunk_entity_relation_graph.upsert_node(target_entity, merged_entity_data)
        logger.info(f"Entity Merge: Updated target '{target_entity}'")

    # 6. Recreate all relations pointing to the target entity in KG
    # Also collect chunk tracking information in the same loop
    relation_updates = {}  # Track relationships that need to be merged
    relations_to_delete = []

    # Initialize chunk tracking variables
    relation_chunk_tracking = {}  # key: storage_key, value: list of chunk_ids
    old_relation_keys_to_delete = []

    for src, tgt, edge_data in all_relations:
        relations_to_delete.append(compute_mdhash_id(src + tgt, prefix="rel-"))
        relations_to_delete.append(compute_mdhash_id(tgt + src, prefix="rel-"))

        # Collect old chunk tracking key for deletion
        if relation_chunks_storage is not None:
            from .utils import make_relation_chunk_key

            old_storage_key = make_relation_chunk_key(src, tgt)
            old_relation_keys_to_delete.append(old_storage_key)

        new_src = target_entity if src in source_entities else src
        new_tgt = target_entity if tgt in source_entities else tgt

        # Skip relationships between source entities to avoid self-loops
        if new_src == new_tgt:
            logger.info(f"Entity Merge: skipping `{src}`~`{tgt}` to avoid self-loop")
            continue

        # Normalize entity order for consistent duplicate detection (undirected relationships)
        normalized_src, normalized_tgt = sorted([new_src, new_tgt])
        relation_key = f"{normalized_src}|{normalized_tgt}"

        # Process chunk tracking for this relation
        if relation_chunks_storage is not None:
            storage_key = make_relation_chunk_key(normalized_src, normalized_tgt)

            # Get chunk_ids from storage for this original relation
            stored = await relation_chunks_storage.get_by_id(old_storage_key)

            if stored is not None and isinstance(stored, dict):
                chunk_ids = [cid for cid in stored.get("chunk_ids", []) if cid]
            else:
                # Fallback to source_id from graph
                source_id = edge_data.get("source_id", "")
                chunk_ids = [cid for cid in source_id.split(GRAPH_FIELD_SEP) if cid]

            # Accumulate chunk_ids with ordered deduplication
            if storage_key not in relation_chunk_tracking:
                relation_chunk_tracking[storage_key] = []

            existing_chunks = set(relation_chunk_tracking[storage_key])
            for chunk_id in chunk_ids:
                if chunk_id not in existing_chunks:
                    existing_chunks.add(chunk_id)
                    relation_chunk_tracking[storage_key].append(chunk_id)

        if relation_key in relation_updates:
            # Merge relationship data
            existing_data = relation_updates[relation_key]["data"]
            merged_relation = _merge_attributes(
                [existing_data, edge_data],
                {
                    "description": "concatenate",
                    "keywords": "join_unique_comma",
                    "source_id": "join_unique",
                    "file_path": "join_unique",
                    "weight": "max",
                },
                filter_none_only=True,  # Use relation behavior: only filter None
            )
            relation_updates[relation_key]["data"] = merged_relation
            logger.debug(
                f"Entity Merge: deduplicating relation `{normalized_src}`~`{normalized_tgt}`"
            )
        else:
            relation_updates[relation_key] = {
                "graph_src": new_src,
                "graph_tgt": new_tgt,
                "norm_src": normalized_src,
                "norm_tgt": normalized_tgt,
                "data": edge_data.copy(),
            }

    # Apply relationship updates
    logger.info(f"Entity Merge: updatign {len(relation_updates)} relations")
    for rel_data in relation_updates.values():
        await chunk_entity_relation_graph.upsert_edge(
            rel_data["graph_src"], rel_data["graph_tgt"], rel_data["data"]
        )
        logger.info(
            f"Entity Merge: updating relation `{rel_data['graph_src']}`~`{rel_data['graph_tgt']}`"
        )

    # Update relation chunk tracking storage
    if relation_chunks_storage is not None and all_relations:
        if old_relation_keys_to_delete:
            await relation_chunks_storage.delete(old_relation_keys_to_delete)

        if relation_chunk_tracking:
            updates = {}
            for storage_key, chunk_ids in relation_chunk_tracking.items():
                updates[storage_key] = {
                    "chunk_ids": chunk_ids,
                    "count": len(chunk_ids),
                }

            await relation_chunks_storage.upsert(updates)
            logger.info(
                f"Entity Merge: {len(updates)} relation chunk tracking records updated"
            )

    # 7. Update relationship vector representations
    logger.debug(
        f"Entity Merge: deleting {len(relations_to_delete)} relations from vdb"
    )
    await relationships_vdb.delete(relations_to_delete)

    for rel_data in relation_updates.values():
        edge_data = rel_data["data"]
        normalized_src = rel_data["norm_src"]
        normalized_tgt = rel_data["norm_tgt"]

        description = edge_data.get("description", "")
        keywords = edge_data.get("keywords", "")
        source_id = edge_data.get("source_id", "")
        weight = float(edge_data.get("weight", 1.0))

        # Use normalized order for content and relation ID
        content = f"{keywords}\t{normalized_src}\n{normalized_tgt}\n{description}"
        relation_id = compute_mdhash_id(normalized_src + normalized_tgt, prefix="rel-")

        relation_data_for_vdb = {
            relation_id: {
                "content": content,
                "src_id": normalized_src,
                "tgt_id": normalized_tgt,
                "source_id": source_id,
                "description": description,
                "keywords": keywords,
                "weight": weight,
                "file_path": edge_data.get("file_path", ""),
            }
        }
        await relationships_vdb.upsert(relation_data_for_vdb)
        logger.debug(
            f"Entity Merge: updating vdb `{normalized_src}`~`{normalized_tgt}`"
        )

    logger.info(f"Entity Merge: {len(relation_updates)} relations in vdb updated")

    # 8. Update entity vector representation
    description = merged_entity_data.get("description", "")
    source_id = merged_entity_data.get("source_id", "")
    entity_type = merged_entity_data.get("entity_type", "")
    content = target_entity + "\n" + description

    entity_id = compute_mdhash_id(target_entity, prefix="ent-")
    entity_data_for_vdb = {
        entity_id: {
            "content": content,
            "entity_name": target_entity,
            "source_id": source_id,
            "description": description,
            "entity_type": entity_type,
            "file_path": merged_entity_data.get("file_path", ""),
        }
    }
    await entities_vdb.upsert(entity_data_for_vdb)
    logger.info(f"Entity Merge: updating vdb `{target_entity}`")

    # 9. Merge entity chunk tracking (source entities first, then target entity)
    if entity_chunks_storage is not None:
        all_chunk_id_lists = []

        # Build list of entities to process (source entities first, then target entity)
        entities_to_process = []

        # Add source entities first (excluding target if it's already in source list)
        for entity_name in source_entities:
            if entity_name != target_entity:
                entities_to_process.append(entity_name)

        # Add target entity last (if it exists)
        if target_exists:
            entities_to_process.append(target_entity)

        # Process all entities in order with unified logic
        for entity_name in entities_to_process:
            stored = await entity_chunks_storage.get_by_id(entity_name)
            if stored and isinstance(stored, dict):
                chunk_ids = [cid for cid in stored.get("chunk_ids", []) if cid]
                if chunk_ids:
                    all_chunk_id_lists.append(chunk_ids)

        # Merge chunk_ids with ordered deduplication (preserves order, source entities first)
        merged_chunk_ids = []
        seen = set()
        for chunk_id_list in all_chunk_id_lists:
            for chunk_id in chunk_id_list:
                if chunk_id not in seen:
                    seen.add(chunk_id)
                    merged_chunk_ids.append(chunk_id)

        # Delete source entities' chunk tracking records
        entity_keys_to_delete = [e for e in source_entities if e != target_entity]
        if entity_keys_to_delete:
            await entity_chunks_storage.delete(entity_keys_to_delete)

        # Update target entity's chunk tracking
        if merged_chunk_ids:
            await entity_chunks_storage.upsert(
                {
                    target_entity: {
                        "chunk_ids": merged_chunk_ids,
                        "count": len(merged_chunk_ids),
                    }
                }
            )
            logger.info(
                f"Entity Merge: find {len(merged_chunk_ids)} chunks related to '{target_entity}'"
            )

    # 10. Delete source entities
    for entity_name in source_entities:
        if entity_name == target_entity:
            logger.warning(
                f"Entity Merge: source entity'{entity_name}' is same as target entity"
            )
            continue

        logger.info(f"Entity Merge: deleting '{entity_name}' from KG and vdb")

        # Delete entity node and related edges from knowledge graph
        await chunk_entity_relation_graph.delete_node(entity_name)

        # Delete entity record from vector database
        entity_id = compute_mdhash_id(entity_name, prefix="ent-")
        await entities_vdb.delete([entity_id])

    # 11. Save changes
    await _persist_graph_updates(
        entities_vdb=entities_vdb,
        relationships_vdb=relationships_vdb,
        chunk_entity_relation_graph=chunk_entity_relation_graph,
        entity_chunks_storage=entity_chunks_storage,
        relation_chunks_storage=relation_chunks_storage,
    )

    logger.info(
        f"Entity Merge: successfully merged {len(source_entities)} entities into '{target_entity}'"
    )
    return await get_entity_info(
        chunk_entity_relation_graph,
        entities_vdb,
        target_entity,
        include_vector_data=True,
    )


async def amerge_entities(
    chunk_entity_relation_graph,
    entities_vdb,
    relationships_vdb,
    source_entities: list[str],
    target_entity: str,
    merge_strategy: dict[str, str] = None,
    target_entity_data: dict[str, Any] = None,
    entity_chunks_storage=None,
    relation_chunks_storage=None,
    expected_revision_tokens: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Asynchronously merge multiple entities into one entity.

    Merges multiple source entities into a target entity, handling all relationships,
    and updating both the knowledge graph and vector database.
    Also merges chunk tracking information from entity_chunks_storage and relation_chunks_storage.

    Args:
        chunk_entity_relation_graph: Graph storage instance
        entities_vdb: Vector database storage for entities
        relationships_vdb: Vector database storage for relationships
        source_entities: List of source entity names to merge
        target_entity: Name of the target entity after merging
        merge_strategy: Deprecated (Each field uses its own default strategy). If provided,
            customizations are applied but a warning is logged.
        target_entity_data: Dictionary of specific values to set for the target entity,
            overriding any merged values, e.g. {"description": "custom description", "entity_type": "PERSON"}
        entity_chunks_storage: Optional KV storage for tracking chunks that reference entities
        relation_chunks_storage: Optional KV storage for tracking chunks that reference relations

    Returns:
        Dictionary containing the merged entity information
    """
    # Collect all entities involved (source + target) and lock them all in sorted order
    all_entities = set(source_entities)
    all_entities.add(target_entity)
    lock_keys = sorted(all_entities)

    workspace = entities_vdb.global_config.get("workspace", "")
    namespace = f"{workspace}:GraphDB" if workspace else "GraphDB"
    async with get_storage_keyed_lock(
        lock_keys, namespace=namespace, enable_logging=False
    ):
        try:
            if expected_revision_tokens:
                valid_entity_names = set(lock_keys)
                unexpected_entities = sorted(
                    set(expected_revision_tokens) - valid_entity_names
                )
                if unexpected_entities:
                    unexpected_entity_names = ", ".join(unexpected_entities)
                    raise ValueError(
                        "Unexpected revision token keys for merge: "
                        f"{unexpected_entity_names}"
                    )

                for entity_name, expected_revision_token in expected_revision_tokens.items():
                    node_data = await chunk_entity_relation_graph.get_node(entity_name)
                    if node_data is None:
                        raise ValueError(
                            f"Cannot validate revision token for missing entity '{entity_name}'"
                        )
                    _validate_expected_revision_token(
                        current_payload=_build_entity_revision_payload(
                            entity_name, node_data
                        ),
                        expected_revision_token=expected_revision_token,
                        object_type="entity",
                    )

            return await _merge_entities_impl(
                chunk_entity_relation_graph,
                entities_vdb,
                relationships_vdb,
                source_entities,
                target_entity,
                merge_strategy=merge_strategy,
                target_entity_data=target_entity_data,
                entity_chunks_storage=entity_chunks_storage,
                relation_chunks_storage=relation_chunks_storage,
            )
        except Exception as e:
            logger.error(f"Error merging entities: {e}")
            raise


_MERGE_SUGGESTION_REASON_WEIGHTS: dict[str, float] = {
    "name_similarity": 0.45,
    "alias_overlap": 0.2,
    "description_overlap": 0.12,
    "shared_neighbors": 0.1,
    "shared_sources": 0.06,
    "shared_file_paths": 0.03,
    "same_entity_type": 0.04,
}
_MERGE_SUGGESTION_MIN_PAIR_SCORE = 0.55
_MERGE_SUGGESTION_LLM_SYSTEM_PROMPT = """
You validate duplicate-entity merge suggestions for a knowledge graph.

Return strict JSON only in this exact shape:
{"scores":[{"candidate_id":"...", "score":0.0}]}

Rules:
- Keep every candidate_id exactly as provided.
- score must be between 0.0 and 1.0.
- Higher score means stronger confidence that the source_entities should merge into target_entity.
- Use the heuristic evidence plus names, aliases, descriptions, neighbors, source overlap, and file overlap.
- Do not add prose, markdown, or code fences.
""".strip()
_MERGE_SUGGESTION_COMMON_SUFFIXES = frozenset(
    {
        "inc",
        "incorporated",
        "corp",
        "corporation",
        "co",
        "company",
        "ltd",
        "limited",
        "llc",
        "plc",
        "group",
        "holdings",
        "holding",
    }
)
_MERGE_SUGGESTION_STOPWORDS = frozenset(
    {
        "the",
        "a",
        "an",
        "and",
        "or",
        "of",
        "to",
        "for",
        "in",
        "on",
        "at",
        "with",
        "by",
        "from",
        "is",
        "are",
        "was",
        "were",
    }
)


def _merge_suggestion_model_dump(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if hasattr(value, "model_dump"):
        dumped = value.model_dump()
        return dumped if isinstance(dumped, dict) else {}
    if isinstance(value, Mapping):
        return dict(value)
    return {}


def _merge_suggestion_split_values(value: Any) -> list[str]:
    if value is None:
        return []

    if isinstance(value, str):
        raw_values = re.split(rf"[,\n;|{re.escape(GRAPH_FIELD_SEP)}]+", value)
    elif isinstance(value, set):
        raw_values = [str(item) for item in value]
    elif isinstance(value, Sequence) and not isinstance(
        value, (str, bytes, bytearray)
    ):
        raw_values = []
        for item in value:
            if item is None:
                continue
            if isinstance(item, str):
                raw_values.extend(
                    re.split(rf"[,\n;|{re.escape(GRAPH_FIELD_SEP)}]+", item)
                )
            else:
                raw_values.append(str(item))
    else:
        raw_values = [str(value)]

    normalized_values: list[str] = []
    seen_values: set[str] = set()
    for raw_value in raw_values:
        normalized = raw_value.strip()
        if not normalized or normalized in seen_values:
            continue
        seen_values.add(normalized)
        normalized_values.append(normalized)
    return normalized_values


def _merge_suggestion_normalize_text(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def _merge_suggestion_tokens(value: str) -> list[str]:
    tokens = [
        token.strip("_")
        for token in re.findall(r"\w+", value.lower(), flags=re.UNICODE)
    ]
    return [token for token in tokens if token]


def _merge_suggestion_compact(value: str) -> str:
    return "".join(_merge_suggestion_tokens(value))


def _merge_suggestion_base_tokens(tokens: list[str]) -> list[str]:
    base_tokens = list(tokens)
    while base_tokens and base_tokens[-1] in _MERGE_SUGGESTION_COMMON_SUFFIXES:
        base_tokens.pop()
    return base_tokens


def _merge_suggestion_overlap_score(
    left_values: set[str], right_values: set[str]
) -> float:
    if not left_values or not right_values:
        return 0.0
    intersection_size = len(left_values.intersection(right_values))
    if intersection_size == 0:
        return 0.0
    return round(intersection_size / max(len(left_values), len(right_values)), 4)


def _merge_suggestion_entity_name(node: dict[str, Any]) -> str:
    properties = _merge_suggestion_model_dump(node.get("properties"))
    for key in ("entity_id", "name"):
        candidate = _merge_suggestion_normalize_text(properties.get(key))
        if candidate:
            return candidate
    return _merge_suggestion_normalize_text(node.get("id"))


def _merge_suggestion_entity_types(node: dict[str, Any]) -> set[str]:
    properties = _merge_suggestion_model_dump(node.get("properties"))
    entity_types = {
        value.lower()
        for value in _merge_suggestion_split_values(properties.get("entity_type"))
    }
    entity_types.update(
        value.lower() for value in _merge_suggestion_split_values(node.get("labels"))
    )
    return {value for value in entity_types if value}


def _merge_suggestion_description_tokens(description: str) -> set[str]:
    return {
        token
        for token in _merge_suggestion_tokens(description)
        if token not in _MERGE_SUGGESTION_STOPWORDS
    }


def _build_merge_suggestion_snapshot(node: dict[str, Any]) -> dict[str, Any] | None:
    entity_name = _merge_suggestion_entity_name(node)
    if not entity_name:
        return None

    properties = _merge_suggestion_model_dump(node.get("properties"))
    normalized_name = _merge_suggestion_normalize_text(entity_name)
    name_tokens = _merge_suggestion_tokens(normalized_name)
    base_tokens = _merge_suggestion_base_tokens(name_tokens)

    alias_values = _merge_alias_groups(
        properties.get("aliases"),
        properties.get("alias"),
        properties.get("name"),
        exclude={entity_name},
    )
    alias_compacts = {
        _merge_suggestion_compact(alias) for alias in alias_values if alias.strip()
    }

    description = _merge_suggestion_normalize_text(properties.get("description"))

    return {
        "entity_name": entity_name,
        "raw_node_id": _merge_suggestion_normalize_text(node.get("id")),
        "normalized_name": normalized_name,
        "compact_name": _merge_suggestion_compact(normalized_name),
        "name_tokens": name_tokens,
        "base_tokens": base_tokens,
        "base_compact_name": "".join(base_tokens),
        "aliases": alias_values,
        "alias_compacts": alias_compacts,
        "entity_types": _merge_suggestion_entity_types(node),
        "description": description,
        "description_tokens": _merge_suggestion_description_tokens(description),
        "source_ids": set(_merge_suggestion_split_values(properties.get("source_id"))),
        "file_paths": set(
            _merge_suggestion_split_values(properties.get("file_path"))
            + _merge_suggestion_split_values(properties.get("file_paths"))
        ),
        "neighbors": set(),
        "degree": 0,
    }


def _augment_merge_suggestion_snapshots_with_edges(
    snapshots: dict[str, dict[str, Any]], edges: list[dict[str, Any]]
) -> None:
    raw_id_to_entity = {
        snapshot["raw_node_id"]: entity_name
        for entity_name, snapshot in snapshots.items()
        if snapshot["raw_node_id"]
    }

    for edge in edges:
        properties = _merge_suggestion_model_dump(edge.get("properties"))
        source = _merge_suggestion_normalize_text(edge.get("source"))
        target = _merge_suggestion_normalize_text(edge.get("target"))
        source_entity = raw_id_to_entity.get(source, source)
        target_entity = raw_id_to_entity.get(target, target)

        if source_entity not in snapshots or target_entity not in snapshots:
            continue

        edge_source_ids = set(_merge_suggestion_split_values(properties.get("source_id")))
        edge_file_paths = set(
            _merge_suggestion_split_values(properties.get("file_path"))
            + _merge_suggestion_split_values(properties.get("file_paths"))
        )

        snapshots[source_entity]["neighbors"].add(target_entity)
        snapshots[target_entity]["neighbors"].add(source_entity)
        snapshots[source_entity]["degree"] += 1
        snapshots[target_entity]["degree"] += 1
        snapshots[source_entity]["source_ids"].update(edge_source_ids)
        snapshots[target_entity]["source_ids"].update(edge_source_ids)
        snapshots[source_entity]["file_paths"].update(edge_file_paths)
        snapshots[target_entity]["file_paths"].update(edge_file_paths)


def _merge_suggestion_name_similarity(
    left_snapshot: dict[str, Any], right_snapshot: dict[str, Any]
) -> float:
    left_compact = left_snapshot["compact_name"]
    right_compact = right_snapshot["compact_name"]
    if not left_compact or not right_compact:
        return 0.0

    if left_compact == right_compact:
        return 1.0

    left_base = left_snapshot["base_compact_name"]
    right_base = right_snapshot["base_compact_name"]
    if left_base and left_base == right_base:
        return 0.96

    left_tokens = set(left_snapshot["name_tokens"])
    right_tokens = set(right_snapshot["name_tokens"])
    subset_bonus = 0.0
    if left_tokens and right_tokens:
        if left_tokens.issubset(right_tokens) or right_tokens.issubset(left_tokens):
            subset_bonus = 0.82

    compact_ratio = SequenceMatcher(None, left_compact, right_compact).ratio()
    spaced_ratio = SequenceMatcher(
        None,
        left_snapshot["normalized_name"].lower(),
        right_snapshot["normalized_name"].lower(),
    ).ratio()
    token_overlap = _merge_suggestion_overlap_score(left_tokens, right_tokens)
    return round(max(compact_ratio, spaced_ratio, token_overlap, subset_bonus), 4)


def _merge_suggestion_alias_overlap(
    left_snapshot: dict[str, Any], right_snapshot: dict[str, Any]
) -> float:
    left_compact = left_snapshot["compact_name"]
    right_compact = right_snapshot["compact_name"]

    if left_compact and left_compact in right_snapshot["alias_compacts"]:
        return 1.0
    if right_compact and right_compact in left_snapshot["alias_compacts"]:
        return 1.0
    if left_snapshot["alias_compacts"].intersection(right_snapshot["alias_compacts"]):
        return 0.94
    return 0.0


def _merge_suggestion_description_overlap(
    left_snapshot: dict[str, Any], right_snapshot: dict[str, Any]
) -> float:
    return _merge_suggestion_overlap_score(
        left_snapshot["description_tokens"], right_snapshot["description_tokens"]
    )


def _merge_suggestion_same_entity_type(
    left_snapshot: dict[str, Any], right_snapshot: dict[str, Any]
) -> float:
    if left_snapshot["entity_types"].intersection(right_snapshot["entity_types"]):
        return 1.0
    return 0.0


def _merge_suggestion_pair_reasons(
    left_snapshot: dict[str, Any], right_snapshot: dict[str, Any]
) -> tuple[list[dict[str, Any]], float]:
    name_similarity = _merge_suggestion_name_similarity(left_snapshot, right_snapshot)
    alias_overlap = _merge_suggestion_alias_overlap(left_snapshot, right_snapshot)
    description_overlap = _merge_suggestion_description_overlap(
        left_snapshot, right_snapshot
    )
    shared_neighbors = _merge_suggestion_overlap_score(
        left_snapshot["neighbors"], right_snapshot["neighbors"]
    )
    shared_sources = _merge_suggestion_overlap_score(
        left_snapshot["source_ids"], right_snapshot["source_ids"]
    )
    shared_file_paths = _merge_suggestion_overlap_score(
        left_snapshot["file_paths"], right_snapshot["file_paths"]
    )
    same_entity_type = _merge_suggestion_same_entity_type(
        left_snapshot, right_snapshot
    )

    reason_scores = {
        "name_similarity": name_similarity,
        "alias_overlap": alias_overlap,
        "description_overlap": description_overlap,
        "shared_neighbors": shared_neighbors,
        "shared_sources": shared_sources,
        "shared_file_paths": shared_file_paths,
        "same_entity_type": same_entity_type,
    }

    identity_signal = (
        alias_overlap >= 0.94
        or name_similarity >= 0.78
        or (
            description_overlap >= 0.45
            and same_entity_type > 0.0
            and max(shared_neighbors, shared_sources, shared_file_paths) >= 0.2
        )
    )
    if not identity_signal:
        return [], 0.0

    weighted_score = sum(
        reason_scores[code] * weight
        for code, weight in _MERGE_SUGGESTION_REASON_WEIGHTS.items()
    )
    if alias_overlap >= 0.94 and weighted_score < 0.72:
        weighted_score = 0.72
    if name_similarity >= 0.96 and weighted_score < 0.68:
        weighted_score = 0.68
    if weighted_score < _MERGE_SUGGESTION_MIN_PAIR_SCORE:
        return [], 0.0

    reasons = [
        {"code": code, "score": round(score, 4)}
        for code, score in reason_scores.items()
        if score > 0.0
    ]
    reasons.sort(key=lambda reason: (-reason["score"], reason["code"]))
    return reasons, round(weighted_score, 4)


def _merge_suggestion_target_support(snapshot: dict[str, Any]) -> float:
    return (
        float(snapshot["degree"]) * 1.5
        + float(len(snapshot["source_ids"])) * 1.0
        + float(len(snapshot["file_paths"])) * 0.5
        + float(len(snapshot["aliases"])) * 0.4
        + float(len(snapshot["description_tokens"])) * 0.05
    )


def _select_merge_suggestion_target(
    left_snapshot: dict[str, Any], right_snapshot: dict[str, Any]
) -> tuple[str, str]:
    left_name = left_snapshot["entity_name"]
    right_name = right_snapshot["entity_name"]

    if left_snapshot["compact_name"] in right_snapshot["alias_compacts"]:
        return right_name, left_name
    if right_snapshot["compact_name"] in left_snapshot["alias_compacts"]:
        return left_name, right_name

    left_base = set(left_snapshot["base_tokens"])
    right_base = set(right_snapshot["base_tokens"])
    if left_base and right_base and left_base == right_base:
        if len(left_snapshot["name_tokens"]) != len(right_snapshot["name_tokens"]):
            return (
                (left_name, right_name)
                if len(left_snapshot["name_tokens"]) < len(right_snapshot["name_tokens"])
                else (right_name, left_name)
            )

    left_tokens = set(left_snapshot["name_tokens"])
    right_tokens = set(right_snapshot["name_tokens"])
    if left_tokens and right_tokens:
        if left_tokens.issubset(right_tokens) and len(left_tokens) < len(right_tokens):
            return left_name, right_name
        if right_tokens.issubset(left_tokens) and len(right_tokens) < len(left_tokens):
            return right_name, left_name

    left_support = _merge_suggestion_target_support(left_snapshot)
    right_support = _merge_suggestion_target_support(right_snapshot)
    if left_support != right_support:
        return (
            (left_name, right_name)
            if left_support > right_support
            else (right_name, left_name)
        )

    if len(left_snapshot["compact_name"]) != len(right_snapshot["compact_name"]):
        return (
            (left_name, right_name)
            if len(left_snapshot["compact_name"]) < len(right_snapshot["compact_name"])
            else (right_name, left_name)
        )

    return (left_name, right_name) if left_name <= right_name else (right_name, left_name)


def _build_merge_suggestion_pair_candidates(
    snapshots: dict[str, dict[str, Any]]
) -> tuple[list[dict[str, Any]], int]:
    entity_names = sorted(snapshots.keys())
    pair_candidates: list[dict[str, Any]] = []
    evaluated_pairs = 0

    for left_index, left_name in enumerate(entity_names):
        for right_name in entity_names[left_index + 1 :]:
            evaluated_pairs += 1
            left_snapshot = snapshots[left_name]
            right_snapshot = snapshots[right_name]
            reasons, score = _merge_suggestion_pair_reasons(
                left_snapshot, right_snapshot
            )
            if not reasons:
                continue

            target_entity, source_entity = _select_merge_suggestion_target(
                left_snapshot, right_snapshot
            )
            pair_candidates.append(
                {
                    "target_entity": target_entity,
                    "source_entity": source_entity,
                    "score": score,
                    "reasons": reasons,
                }
            )

    pair_candidates.sort(
        key=lambda candidate: (
            -candidate["score"],
            candidate["target_entity"],
            candidate["source_entity"],
        )
    )
    return pair_candidates, evaluated_pairs


def _group_merge_suggestion_candidates(
    pair_candidates: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    best_target_by_source: dict[str, dict[str, Any]] = {}
    for pair_candidate in pair_candidates:
        source_entity = pair_candidate["source_entity"]
        current_best = best_target_by_source.get(source_entity)
        if current_best is None or pair_candidate["score"] > current_best["score"]:
            best_target_by_source[source_entity] = pair_candidate

    grouped: dict[str, dict[str, Any]] = {}
    for pair_candidate in best_target_by_source.values():
        target_entity = pair_candidate["target_entity"]
        source_entity = pair_candidate["source_entity"]
        group = grouped.setdefault(
            target_entity,
            {
                "target_entity": target_entity,
                "source_entities": [],
                "pair_scores": [],
                "reason_scores": {},
            },
        )
        group["source_entities"].append(source_entity)
        group["pair_scores"].append(pair_candidate["score"])
        for reason in pair_candidate["reasons"]:
            existing_score = group["reason_scores"].get(reason["code"], 0.0)
            group["reason_scores"][reason["code"]] = max(
                existing_score, reason["score"]
            )

    candidates: list[dict[str, Any]] = []
    for group in grouped.values():
        source_entities = sorted(set(group["source_entities"]))
        if not source_entities:
            continue

        reasons = [
            {"code": code, "score": round(score, 4)}
            for code, score in sorted(
                group["reason_scores"].items(), key=lambda item: (-item[1], item[0])
            )
        ]
        score = round(sum(group["pair_scores"]) / len(group["pair_scores"]), 4)
        candidates.append(
            {
                "target_entity": group["target_entity"],
                "source_entities": source_entities,
                "score": score,
                "reasons": reasons,
            }
        )

    candidates.sort(
        key=lambda candidate: (-candidate["score"], candidate["target_entity"])
    )
    return candidates


def _merge_suggestion_candidate_id(candidate: dict[str, Any]) -> str:
    return (
        f"{candidate['target_entity']}<-"
        f"{'|'.join(sorted(candidate['source_entities']))}"
    )


def _merge_suggestion_snapshot_summary(snapshot: dict[str, Any]) -> dict[str, Any]:
    return {
        "entity_name": snapshot["entity_name"],
        "entity_types": sorted(snapshot["entity_types"]),
        "aliases": snapshot["aliases"][:5],
        "description": snapshot["description"][:240],
        "degree": snapshot["degree"],
        "neighbors": sorted(snapshot["neighbors"])[:8],
        "source_ids_count": len(snapshot["source_ids"]),
        "file_paths_count": len(snapshot["file_paths"]),
    }


async def _rerank_merge_suggestion_candidates_with_llm(
    rag: Any,
    candidates: list[dict[str, Any]],
    snapshots: dict[str, dict[str, Any]],
    llm_limit: int,
) -> tuple[list[dict[str, Any]], bool, str | None]:
    llm_model_func = getattr(rag, "llm_model_func", None)
    if not callable(llm_model_func):
        return candidates, False, "llm_model_func unavailable"

    llm_model_func = cast(Any, partial(llm_model_func, _priority=5))

    llm_candidates = candidates[:llm_limit]
    prompt_payload = {
        "task": "rerank_merge_suggestions",
        "candidates": [
            {
                "candidate_id": _merge_suggestion_candidate_id(candidate),
                "target_entity": candidate["target_entity"],
                "source_entities": candidate["source_entities"],
                "heuristic_score": candidate["score"],
                "heuristic_reasons": candidate["reasons"],
                "target_summary": _merge_suggestion_snapshot_summary(
                    snapshots[candidate["target_entity"]]
                ),
                "source_summaries": [
                    _merge_suggestion_snapshot_summary(snapshots[source_entity])
                    for source_entity in candidate["source_entities"]
                    if source_entity in snapshots
                ],
            }
            for candidate in llm_candidates
        ],
    }

    try:
        raw_response = await llm_model_func(
            json.dumps(prompt_payload, ensure_ascii=False),
            system_prompt=_MERGE_SUGGESTION_LLM_SYSTEM_PROMPT,
        )
        if not isinstance(raw_response, str):
            raise ValueError("LLM merge suggestion rerank did not return text")

        parsed_response = json_repair.loads(remove_think_tags(raw_response))
        score_items = parsed_response.get("scores", []) if isinstance(parsed_response, dict) else []
        llm_scores: dict[str, float] = {}
        if isinstance(score_items, Sequence) and not isinstance(
            score_items, (str, bytes, bytearray)
        ):
            for item in score_items:
                item_payload = _merge_suggestion_model_dump(item)
                candidate_id = _merge_suggestion_normalize_text(
                    item_payload.get("candidate_id")
                )
                if not candidate_id:
                    continue
                try:
                    score = float(item_payload.get("score"))
                except (TypeError, ValueError):
                    continue
                llm_scores[candidate_id] = max(0.0, min(1.0, score))

        if not llm_scores:
            raise ValueError("LLM rerank returned no candidate scores")

        reranked_candidates: list[dict[str, Any]] = []
        for candidate in candidates:
            candidate_copy = {
                "target_entity": candidate["target_entity"],
                "source_entities": list(candidate["source_entities"]),
                "score": candidate["score"],
                "reasons": [dict(reason) for reason in candidate["reasons"]],
            }
            candidate_id = _merge_suggestion_candidate_id(candidate_copy)
            llm_score = llm_scores.get(candidate_id)
            if llm_score is not None:
                candidate_copy["score"] = round(
                    candidate_copy["score"] * 0.65 + llm_score * 0.35,
                    4,
                )
            reranked_candidates.append(candidate_copy)

        reranked_candidates.sort(
            key=lambda candidate: (-candidate["score"], candidate["target_entity"])
        )
        return reranked_candidates, True, None
    except Exception as e:
        logger.warning(f"Falling back to heuristic merge suggestions: {e}")
        return candidates, False, str(e)


async def aget_merge_suggestions(
    rag: Any, request: Mapping[str, Any] | dict[str, Any]
) -> dict[str, Any]:
    request_payload = _merge_suggestion_model_dump(request)
    scope = _merge_suggestion_model_dump(request_payload.get("scope"))
    scope_label = _merge_suggestion_normalize_text(scope.get("label")) or "*"
    max_depth = int(scope.get("max_depth") or 3)
    max_nodes = int(scope.get("max_nodes") or 1000)
    min_score = float(request_payload.get("min_score") or 0.0)
    limit = int(request_payload.get("limit") or 20)
    use_llm = bool(request_payload.get("use_llm"))

    raw_graph = await rag.get_knowledge_graph(
        node_label=scope_label,
        max_depth=max_depth,
        max_nodes=max_nodes,
    )
    raw_graph_payload = _merge_suggestion_model_dump(raw_graph)
    raw_nodes = raw_graph_payload.get("nodes", [])
    raw_edges = raw_graph_payload.get("edges", [])
    nodes: list[dict[str, Any]] = []
    if isinstance(raw_nodes, Sequence) and not isinstance(raw_nodes, (str, bytes, bytearray)):
        nodes = [_merge_suggestion_model_dump(node) for node in raw_nodes]

    edges: list[dict[str, Any]] = []
    if isinstance(raw_edges, Sequence) and not isinstance(raw_edges, (str, bytes, bytearray)):
        edges = [_merge_suggestion_model_dump(edge) for edge in raw_edges]

    snapshots: dict[str, dict[str, Any]] = {}
    for node in nodes:
        snapshot = _build_merge_suggestion_snapshot(node)
        if snapshot is None:
            continue
        snapshots[snapshot["entity_name"]] = snapshot

    _augment_merge_suggestion_snapshots_with_edges(snapshots, edges)
    pair_candidates, evaluated_pairs = _build_merge_suggestion_pair_candidates(
        snapshots
    )
    candidates = _group_merge_suggestion_candidates(pair_candidates)

    meta: dict[str, Any] = {
        "strategy": "heuristic_v1",
        "llm_requested": use_llm,
        "llm_used": False,
        "llm_fallback_reason": None,
        "scoped_nodes": len(snapshots),
        "evaluated_pairs": evaluated_pairs,
    }

    if use_llm and candidates:
        llm_limit = min(max(limit * 2, 6), 20, len(candidates))
        candidates, llm_used, fallback_reason = (
            await _rerank_merge_suggestion_candidates_with_llm(
                rag, candidates, snapshots, llm_limit
            )
        )
        meta["llm_used"] = llm_used
        if llm_used:
            meta["strategy"] = "heuristic_llm_rerank_v1"
        elif fallback_reason:
            meta["strategy"] = "heuristic_v1_fallback"
            meta["llm_fallback_reason"] = fallback_reason

    filtered_candidates = [
        candidate for candidate in candidates if candidate["score"] >= min_score
    ][:limit]

    return {
        "candidates": filtered_candidates,
        "meta": meta,
    }


def _merge_attributes(
    data_list: list[dict[str, Any]],
    merge_strategy: dict[str, str],
    filter_none_only: bool = False,
) -> dict[str, Any]:
    """Merge attributes from multiple entities or relationships.

    This unified function handles merging of both entity and relationship attributes,
    applying different merge strategies per field.

    Args:
        data_list: List of dictionaries containing entity or relationship data
        merge_strategy: Merge strategy for each field. Supported strategies:
            - "concatenate": Join all values with GRAPH_FIELD_SEP
            - "keep_first": Keep the first non-empty value
            - "keep_last": Keep the last non-empty value
            - "join_unique": Join unique items separated by GRAPH_FIELD_SEP
            - "join_unique_comma": Join unique items separated by comma and space
            - "max": Keep the maximum numeric value (for numeric fields)
        filter_none_only: If True, only filter None values (keep empty strings, 0, etc.).
            If False, filter all falsy values. Default is False for backward compatibility.

    Returns:
        Dictionary containing merged data
    """
    merged_data = {}

    # Collect all possible keys
    all_keys = set()
    for data in data_list:
        all_keys.update(data.keys())

    # Merge values for each key
    for key in all_keys:
        # Get all values for this key based on filtering mode
        if filter_none_only:
            values = [data.get(key) for data in data_list if data.get(key) is not None]
        else:
            values = [data.get(key) for data in data_list if data.get(key)]

        if not values:
            continue

        # Merge values according to strategy
        strategy = merge_strategy.get(key, "keep_first")

        if strategy == "concatenate":
            # Convert all values to strings and join with GRAPH_FIELD_SEP
            merged_data[key] = GRAPH_FIELD_SEP.join(str(v) for v in values)
        elif strategy == "keep_first":
            merged_data[key] = values[0]
        elif strategy == "keep_last":
            merged_data[key] = values[-1]
        elif strategy == "join_unique":
            # Preserve first-seen order while removing duplicates.
            unique_items: list[str] = []
            seen_items: set[str] = set()
            for value in values:
                items = str(value).split(GRAPH_FIELD_SEP)
                for item in items:
                    if not item or item in seen_items:
                        continue
                    seen_items.add(item)
                    unique_items.append(item)
            merged_data[key] = GRAPH_FIELD_SEP.join(unique_items)
        elif strategy == "join_unique_comma":
            # Handle fields separated by comma, join unique items with comma
            unique_items = set()
            for value in values:
                items = str(value).split(",")
                unique_items.update(item.strip() for item in items if item.strip())
            merged_data[key] = ",".join(sorted(unique_items))
        elif strategy == "max":
            # For numeric fields like weight
            try:
                merged_data[key] = max(float(v) for v in values)
            except (ValueError, TypeError):
                # Fallback to first value if conversion fails
                merged_data[key] = values[0]
        else:
            # Default strategy: keep first value
            merged_data[key] = values[0]

    return merged_data


async def get_entity_info(
    chunk_entity_relation_graph,
    entities_vdb,
    entity_name: str,
    include_vector_data: bool = False,
) -> dict[str, Any]:
    """Get detailed information of an entity"""

    # Get information from the graph
    node_data = await chunk_entity_relation_graph.get_node(entity_name)
    source_id = node_data.get("source_id") if node_data else None
    aliases = _normalize_aliases(node_data.get("aliases") if node_data else None)

    result: dict[str, str | None | dict[str, str]] = {
        "entity_name": entity_name,
        "source_id": source_id,
        "aliases": aliases,
        "graph_data": node_data,
    }

    # Optional: Get vector database information
    if include_vector_data:
        entity_id = compute_mdhash_id(entity_name, prefix="ent-")
        vector_data = await entities_vdb.get_by_id(entity_id)
        result["vector_data"] = vector_data

    result["revision_token"] = build_revision_token(
        _build_entity_revision_payload(entity_name, node_data)
    )

    return result


async def get_relation_info(
    chunk_entity_relation_graph,
    relationships_vdb,
    src_entity: str,
    tgt_entity: str,
    include_vector_data: bool = False,
) -> dict[str, Any]:
    """
    Get detailed information of a relationship between two entities.
    Relationship is unidirectional, swap src_entity and tgt_entity does not change the relationship.

    Args:
        src_entity: Source entity name
        tgt_entity: Target entity name
        include_vector_data: Whether to include vector database information

    Returns:
        Dictionary containing relationship information
    """

    # Get information from the graph
    src_entity, tgt_entity = _normalize_relation_endpoints(src_entity, tgt_entity)

    edge_data = await chunk_entity_relation_graph.get_edge(src_entity, tgt_entity)
    source_id = edge_data.get("source_id") if edge_data else None

    result: dict[str, str | None | dict[str, str]] = {
        "src_entity": src_entity,
        "tgt_entity": tgt_entity,
        "source_id": source_id,
        "graph_data": edge_data,
    }

    # Optional: Get vector database information
    if include_vector_data:
        vector_data = None
        for rel_id in make_relation_vdb_ids(src_entity, tgt_entity):
            vector_data = await relationships_vdb.get_by_id(rel_id)
            if vector_data is not None:
                break
        result["vector_data"] = vector_data

    result["revision_token"] = build_revision_token(
        _build_relation_revision_payload(src_entity, tgt_entity, edge_data)
    )

    return result
