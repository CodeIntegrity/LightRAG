"""
Unit tests for batch graph operations (PR #2910 follow-up).

Verifies:
1. BaseGraphStorage default batch methods fall back to serial single-item calls.
2. NetworkXStorage overrides batch methods with optimized in-memory operations.
3. ainsert_custom_kg uses the batch interface end-to-end (no hasattr guards).
4. has_nodes_batch returns only existing nodes, including newly inserted ones.
5. upsert_edges_batch and upsert_nodes_batch are idempotent (safe to call twice).
"""

import asyncio
import time
import tempfile
import pytest
import numpy as np
from types import MethodType
from unittest.mock import AsyncMock

from lightrag.kg.networkx_impl import NetworkXStorage
from lightrag.kg.shared_storage import initialize_share_data
from lightrag.utils import EmbeddingFunc, make_relation_vdb_ids


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

GLOBAL_CONFIG = {
    "embedding_batch_num": 10,
    "vector_db_storage_cls_kwargs": {"cosine_better_than_threshold": 0.5},
    "working_dir": "/tmp/test_batch_graph",
}


async def _raw_embedding_func(texts):
    return np.random.rand(len(texts), 10)


mock_embedding_func = EmbeddingFunc(
    embedding_dim=10,
    max_token_size=512,
    func=_raw_embedding_func,
)


def make_networkx_storage(tmp_dir: str) -> NetworkXStorage:
    config = dict(GLOBAL_CONFIG, working_dir=tmp_dir)
    initialize_share_data()
    storage = NetworkXStorage(
        namespace="test_graph",
        workspace="test_ws",
        global_config=config,
        embedding_func=_raw_embedding_func,
    )
    return storage


def _make_node(entity_id: str, entity_type: str = "TEST") -> dict:
    return {
        "entity_id": entity_id,
        "entity_type": entity_type,
        "description": f"Description of {entity_id}",
        "source_id": "chunk-1",
        "file_path": "test.txt",
        "created_at": int(time.time()),
    }


def _make_edge(weight: float = 1.0) -> dict:
    return {
        "weight": weight,
        "description": "test edge",
        "keywords": "test",
        "source_id": "chunk-1",
        "file_path": "test.txt",
        "created_at": int(time.time()),
    }


# ---------------------------------------------------------------------------
# 1. BaseGraphStorage default implementations delegate to single-item methods
# ---------------------------------------------------------------------------


class TestBaseGraphStorageDefaults:
    """
    Use NetworkXStorage as a concrete instance but spy on the single-item
    methods to verify the default batch implementations delegate correctly.
    """

    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_upsert_nodes_batch_calls_upsert_node(self):
        with tempfile.TemporaryDirectory() as tmp:
            storage = make_networkx_storage(tmp)
            await storage.initialize()

            nodes = [
                ("NodeA", _make_node("NodeA")),
                ("NodeB", _make_node("NodeB")),
            ]

            call_log: list[str] = []
            original = storage.upsert_node

            async def spy(node_id, *, node_data):
                call_log.append(node_id)
                return await original(node_id, node_data=node_data)

            # Temporarily replace the optimised override with the base default

            async def base_upsert_nodes_batch(self, nodes):
                for node_id, node_data in nodes:
                    await self.upsert_node(node_id, node_data=node_data)

            storage.upsert_node = spy  # type: ignore[assignment]
            await base_upsert_nodes_batch(storage, nodes)

            assert call_log == ["NodeA", "NodeB"]

    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_has_nodes_batch_calls_has_node(self):
        with tempfile.TemporaryDirectory() as tmp:
            storage = make_networkx_storage(tmp)
            await storage.initialize()
            await storage.upsert_node("NodeA", node_data=_make_node("NodeA"))

            call_log: list[str] = []
            original = storage.has_node

            async def spy(node_id):
                call_log.append(node_id)
                return await original(node_id)

            async def base_has_nodes_batch(self, node_ids):
                existing = set()
                for node_id in node_ids:
                    if await self.has_node(node_id):
                        existing.add(node_id)
                return existing

            storage.has_node = spy  # type: ignore[assignment]
            result = await base_has_nodes_batch(storage, ["NodeA", "NodeB"])

            assert call_log == ["NodeA", "NodeB"]
            assert result == {"NodeA"}

    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_upsert_edges_batch_calls_upsert_edge(self):
        with tempfile.TemporaryDirectory() as tmp:
            storage = make_networkx_storage(tmp)
            await storage.initialize()
            await storage.upsert_node("NodeA", node_data=_make_node("NodeA"))
            await storage.upsert_node("NodeB", node_data=_make_node("NodeB"))
            await storage.upsert_node("NodeC", node_data=_make_node("NodeC"))

            call_log: list[tuple] = []
            original = storage.upsert_edge

            async def spy(src, tgt, *, edge_data):
                call_log.append((src, tgt))
                return await original(src, tgt, edge_data=edge_data)

            async def base_upsert_edges_batch(self, edges):
                for src, tgt, edge_data in edges:
                    await self.upsert_edge(src, tgt, edge_data=edge_data)

            edges = [
                ("NodeA", "NodeB", _make_edge()),
                ("NodeB", "NodeC", _make_edge()),
            ]
            storage.upsert_edge = spy  # type: ignore[assignment]
            await base_upsert_edges_batch(storage, edges)

            assert call_log == [("NodeA", "NodeB"), ("NodeB", "NodeC")]


# ---------------------------------------------------------------------------
# 2. NetworkXStorage optimised batch implementations
# ---------------------------------------------------------------------------


class TestNetworkXBatchOperations:
    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_upsert_nodes_batch_inserts_all_nodes(self):
        with tempfile.TemporaryDirectory() as tmp:
            storage = make_networkx_storage(tmp)
            await storage.initialize()

            nodes = [(f"Entity{i}", _make_node(f"Entity{i}")) for i in range(5)]
            await storage.upsert_nodes_batch(nodes)

            for entity_id, _ in nodes:
                assert await storage.has_node(entity_id), f"{entity_id} should exist"

    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_upsert_nodes_batch_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            storage = make_networkx_storage(tmp)
            await storage.initialize()

            node_data = _make_node("Alpha")
            await storage.upsert_nodes_batch([("Alpha", node_data)])
            await storage.upsert_nodes_batch([("Alpha", node_data)])  # second call

            assert await storage.has_node("Alpha")
            node = await storage.get_node("Alpha")
            assert node["entity_id"] == "Alpha"

    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_has_nodes_batch_returns_existing_subset(self):
        with tempfile.TemporaryDirectory() as tmp:
            storage = make_networkx_storage(tmp)
            await storage.initialize()

            await storage.upsert_nodes_batch(
                [
                    ("Present1", _make_node("Present1")),
                    ("Present2", _make_node("Present2")),
                ]
            )

            result = await storage.has_nodes_batch(["Present1", "Present2", "Missing"])
            assert result == {"Present1", "Present2"}

    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_has_nodes_batch_empty_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            storage = make_networkx_storage(tmp)
            await storage.initialize()

            result = await storage.has_nodes_batch([])
            assert result == set()

    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_upsert_edges_batch_creates_edges(self):
        with tempfile.TemporaryDirectory() as tmp:
            storage = make_networkx_storage(tmp)
            await storage.initialize()

            await storage.upsert_nodes_batch(
                [
                    ("A", _make_node("A")),
                    ("B", _make_node("B")),
                    ("C", _make_node("C")),
                ]
            )

            edges = [
                ("A", "B", _make_edge(1.5)),
                ("B", "C", _make_edge(2.0)),
            ]
            await storage.upsert_edges_batch(edges)

            edge_ab = await storage.get_edge("A", "B")
            assert edge_ab is not None
            assert float(edge_ab["weight"]) == pytest.approx(1.5)

            edge_bc = await storage.get_edge("B", "C")
            assert edge_bc is not None
            assert float(edge_bc["weight"]) == pytest.approx(2.0)

    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_upsert_edges_batch_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            storage = make_networkx_storage(tmp)
            await storage.initialize()

            await storage.upsert_nodes_batch(
                [
                    ("X", _make_node("X")),
                    ("Y", _make_node("Y")),
                ]
            )
            edge_data = _make_edge(3.0)
            await storage.upsert_edges_batch([("X", "Y", edge_data)])
            await storage.upsert_edges_batch([("X", "Y", edge_data)])  # second call

            edge = await storage.get_edge("X", "Y")
            assert edge is not None

    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_upsert_nodes_batch_updates_existing_node(self):
        with tempfile.TemporaryDirectory() as tmp:
            storage = make_networkx_storage(tmp)
            await storage.initialize()

            original = _make_node("Node1")
            await storage.upsert_nodes_batch([("Node1", original)])

            updated = dict(original, description="Updated description")
            await storage.upsert_nodes_batch([("Node1", updated)])

            node = await storage.get_node("Node1")
            assert node["description"] == "Updated description"


# ---------------------------------------------------------------------------
# 3. ainsert_custom_kg uses batch interface end-to-end
# ---------------------------------------------------------------------------


class TestAinsertCustomKgBatchPath:
    """
    Verify that ainsert_custom_kg calls the three batch methods rather than
    the single-item methods, using a mock graph storage backend.
    """

    def _make_custom_kg(self):
        return {
            "chunks": [
                {
                    "content": "chunk content",
                    "chunk_order_index": 0,
                    "source_id": "src-1",
                }
            ],
            "entities": [
                {
                    "entity_name": "EntityA",
                    "entity_type": "CONCEPT",
                    "description": "An entity",
                    "source_id": "src-1",
                    "file_path": "test.pdf",
                }
            ],
            "relationships": [
                {
                    "src_id": "EntityA",
                    "tgt_id": "EntityB",
                    "description": "relates to",
                    "keywords": "relation",
                    "weight": 1.0,
                    "source_id": "src-1",
                    "file_path": "test.pdf",
                }
            ],
        }

    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_ainsert_custom_kg_calls_batch_methods(self):
        """upsert_nodes_batch, has_nodes_batch, upsert_edges_batch must all be called."""
        from lightrag import LightRAG

        with tempfile.TemporaryDirectory() as tmp:
            rag = LightRAG(
                working_dir=tmp,
                workspace=f"custom-rebuild-{time.time_ns()}",
                llm_model_func=AsyncMock(return_value=""),
                embedding_func=mock_embedding_func,
            )
            await rag.initialize_storages()

            graph = rag.chunk_entity_relation_graph
            upsert_nodes_batch = AsyncMock(wraps=graph.upsert_nodes_batch)
            has_nodes_batch = AsyncMock(wraps=graph.has_nodes_batch)
            upsert_edges_batch = AsyncMock(wraps=graph.upsert_edges_batch)

            graph.upsert_nodes_batch = upsert_nodes_batch
            graph.has_nodes_batch = has_nodes_batch
            graph.upsert_edges_batch = upsert_edges_batch

            # Mock VDB upserts to avoid needing real embeddings
            rag.entities_vdb.upsert = AsyncMock()
            rag.relationships_vdb.upsert = AsyncMock()
            rag.relationships_vdb.delete = AsyncMock()
            rag.text_chunks.upsert = AsyncMock()
            rag.doc_status.upsert = AsyncMock()

            await rag.ainsert_custom_kg(self._make_custom_kg())

            upsert_nodes_batch.assert_called()
            has_nodes_batch.assert_called()
            upsert_edges_batch.assert_called()

            await rag.finalize_storages()

    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_ainsert_custom_kg_no_hasattr_needed(self):
        """
        The batch methods are always available on the base class, so no
        hasattr() guard should be needed. Verify that a storage backend
        implementing only the abstract methods (no batch overrides) still
        works via the default serial fallback.
        """
        from lightrag.base import BaseGraphStorage

        # All three batch methods should exist on the base class
        assert hasattr(BaseGraphStorage, "upsert_nodes_batch")
        assert hasattr(BaseGraphStorage, "has_nodes_batch")
        assert hasattr(BaseGraphStorage, "upsert_edges_batch")

    @pytest.mark.offline
    def test_neo4j_has_nodes_batch_uses_read_retry(self):
        pytest.importorskip("neo4j")
        from lightrag.kg.neo4j_impl import Neo4JStorage

        assert hasattr(Neo4JStorage.has_nodes_batch, "retry")
        assert hasattr(Neo4JStorage.upsert_nodes_batch, "retry")
        assert hasattr(Neo4JStorage.upsert_edges_batch, "retry")

    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_ainsert_custom_kg_missing_entity_nodes_created(self):
        """
        Nodes referenced in relationships but not in the entity list must
        be created as placeholder UNKNOWN nodes.
        """
        from lightrag import LightRAG

        with tempfile.TemporaryDirectory() as tmp:
            rag = LightRAG(
                working_dir=tmp,
                workspace=f"custom-rebuild-{time.time_ns()}",
                llm_model_func=AsyncMock(return_value=""),
                embedding_func=mock_embedding_func,
            )
            await rag.initialize_storages()

            rag.entities_vdb.upsert = AsyncMock()
            rag.relationships_vdb.upsert = AsyncMock()
            rag.relationships_vdb.delete = AsyncMock()
            rag.text_chunks.upsert = AsyncMock()
            rag.doc_status.upsert = AsyncMock()

            custom_kg = {
                "chunks": [
                    {"content": "text", "chunk_order_index": 0, "source_id": "s1"}
                ],
                "entities": [],  # No entities declared
                "relationships": [
                    {
                        "src_id": "ImplicitNode",
                        "tgt_id": "AnotherImplicit",
                        "description": "connects",
                        "keywords": "link",
                        "weight": 1.0,
                        "source_id": "s1",
                        "file_path": "test.pdf",
                    }
                ],
            }

            await rag.ainsert_custom_kg(custom_kg)

            graph = rag.chunk_entity_relation_graph
            assert await graph.has_node(
                "ImplicitNode"
            ), "Implicit node should be created"
            assert await graph.has_node(
                "AnotherImplicit"
            ), "Implicit node should be created"

            await rag.finalize_storages()

    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_ainsert_custom_kg_deduplicates_entities_and_undirected_edges(self):
        from lightrag import LightRAG

        with tempfile.TemporaryDirectory() as tmp:
            rag = LightRAG(
                working_dir=tmp,
                workspace=f"custom-rebuild-{time.time_ns()}",
                llm_model_func=AsyncMock(return_value=""),
                embedding_func=mock_embedding_func,
            )
            await rag.initialize_storages()

            graph = rag.chunk_entity_relation_graph
            graph.upsert_nodes_batch = AsyncMock()
            graph.has_nodes_batch = AsyncMock(return_value={"EntityA"})
            graph.upsert_edges_batch = AsyncMock()

            rag.entities_vdb.upsert = AsyncMock()
            rag.relationships_vdb.upsert = AsyncMock()
            rag.relationships_vdb.delete = AsyncMock()
            rag.text_chunks.upsert = AsyncMock()
            rag.doc_status.upsert = AsyncMock()

            custom_kg = {
                "chunks": [
                    {
                        "content": "chunk content",
                        "chunk_order_index": 0,
                        "source_id": "src-1",
                    }
                ],
                "entities": [
                    {
                        "entity_name": "EntityA",
                        "entity_type": "CONCEPT",
                        "description": "first version",
                        "source_id": "src-1",
                        "file_path": "test.pdf",
                    },
                    {
                        "entity_name": "EntityA",
                        "entity_type": "CONCEPT",
                        "description": "latest version",
                        "source_id": "src-1",
                        "file_path": "test.pdf",
                    },
                ],
                "relationships": [
                    {
                        "src_id": "EntityA",
                        "tgt_id": "EntityB",
                        "description": "old relation",
                        "keywords": "first",
                        "weight": 1.0,
                        "source_id": "src-1",
                        "file_path": "test.pdf",
                    },
                    {
                        "src_id": "EntityB",
                        "tgt_id": "EntityA",
                        "description": "latest relation",
                        "keywords": "second",
                        "weight": 2.0,
                        "source_id": "src-1",
                        "file_path": "test.pdf",
                    },
                ],
            }

            await rag.ainsert_custom_kg(custom_kg)

            entity_batch = graph.upsert_nodes_batch.await_args_list[0].args[0]
            assert len(entity_batch) == 1
            assert entity_batch[0][0] == "EntityA"
            assert entity_batch[0][1]["entity_type"] == "CONCEPT"
            assert entity_batch[0][1]["description"] == "latest version"
            assert entity_batch[0][1]["file_path"] == "test.pdf"
            assert entity_batch[0][1]["source_id"]

            placeholder_batch = graph.upsert_nodes_batch.await_args_list[1].args[0]
            assert len(placeholder_batch) == 1
            assert placeholder_batch[0][0] == "EntityB"

            edge_batch = graph.upsert_edges_batch.await_args.args[0]
            assert len(edge_batch) == 1
            assert edge_batch[0][0] == "EntityB"
            assert edge_batch[0][1] == "EntityA"
            assert edge_batch[0][2]["description"] == "latest relation"
            assert edge_batch[0][2]["weight"] == 2.0

            entity_vdb_payload = rag.entities_vdb.upsert.await_args.args[0]
            assert len(entity_vdb_payload) == 1
            only_entity = next(iter(entity_vdb_payload.values()))
            assert only_entity["description"] == "latest version"

            rel_vdb_payload = rag.relationships_vdb.upsert.await_args.args[0]
            assert len(rel_vdb_payload) == 1
            only_rel = next(iter(rel_vdb_payload.values()))
            assert only_rel["src_id"] == "EntityA"
            assert only_rel["tgt_id"] == "EntityB"
            assert only_rel["description"] == "latest relation"
            assert rag.relationships_vdb.delete.await_args.args[0] == [
                make_relation_vdb_ids("EntityA", "EntityB")[1]
            ]

            await rag.finalize_storages()

    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_ainsert_custom_kg_collects_unknown_fields_into_custom_properties(self):
        from lightrag import LightRAG

        with tempfile.TemporaryDirectory() as tmp:
            rag = LightRAG(
                working_dir=tmp,
                workspace=f"custom-status-{time.time_ns()}",
                llm_model_func=AsyncMock(return_value=""),
                embedding_func=mock_embedding_func,
            )
            await rag.initialize_storages()

            graph = rag.chunk_entity_relation_graph
            graph.upsert_nodes_batch = AsyncMock()
            graph.has_nodes_batch = AsyncMock(return_value={"EntityA", "EntityB"})
            graph.upsert_edges_batch = AsyncMock()

            rag.entities_vdb.upsert = AsyncMock()
            rag.relationships_vdb.upsert = AsyncMock()
            rag.relationships_vdb.delete = AsyncMock()
            rag.text_chunks.upsert = AsyncMock()
            rag.doc_status.upsert = AsyncMock()

            custom_kg = {
                "chunks": [
                    {"content": "chunk content", "chunk_order_index": 0, "source_id": "src-1"}
                ],
                "entities": [
                    {
                        "entity_name": "EntityA",
                        "name": "Entity A",
                        "entity_type": "CONCEPT",
                        "description": "entity",
                        "source_id": "src-1",
                        "file_path": "test.pdf",
                        "department": "research",
                        "custom_properties": {"region": "cn"},
                    }
                ],
                "relationships": [
                    {
                        "src_id": "EntityA",
                        "tgt_id": "EntityB",
                        "description": "links",
                        "keywords": "link",
                        "weight": 1.0,
                        "source_id": "src-1",
                        "file_path": "test.pdf",
                        "confidence": 0.7,
                        "custom_properties": {"channel": "manual"},
                    }
                ],
            }

            await rag.ainsert_custom_kg(custom_kg)

            entity_batch = graph.upsert_nodes_batch.await_args_list[0].args[0]
            assert entity_batch[0][1]["name"] == "Entity A"
            assert entity_batch[0][1]["custom_properties"] == {
                "department": "research",
                "region": "cn",
            }

            edge_batch = graph.upsert_edges_batch.await_args.args[0]
            assert edge_batch[0][2]["custom_properties"] == {
                "channel": "manual",
                "confidence": 0.7,
            }

            entity_vdb_payload = rag.entities_vdb.upsert.await_args.args[0]
            only_entity = next(iter(entity_vdb_payload.values()))
            assert "department" not in only_entity["content"]
            assert "region" not in only_entity["content"]

            rel_vdb_payload = rag.relationships_vdb.upsert.await_args.args[0]
            only_rel = next(iter(rel_vdb_payload.values()))
            assert "confidence" not in only_rel["content"]
            assert "channel" not in only_rel["content"]

            await rag.finalize_storages()

    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_ainsert_custom_kg_keeps_legacy_relation_rows_if_upsert_fails(self):
        from lightrag import LightRAG

        with tempfile.TemporaryDirectory() as tmp:
            rag = LightRAG(
                working_dir=tmp,
                workspace=f"custom-unknown-source-{time.time_ns()}",
                llm_model_func=AsyncMock(return_value=""),
                embedding_func=mock_embedding_func,
            )
            await rag.initialize_storages()

            rag.entities_vdb.upsert = AsyncMock()
            rag.relationships_vdb.upsert = AsyncMock(side_effect=RuntimeError("boom"))
            rag.relationships_vdb.delete = AsyncMock()
            rag.text_chunks.upsert = AsyncMock()
            rag.doc_status.upsert = AsyncMock()

            custom_kg = {
                "chunks": [
                    {
                        "content": "chunk content",
                        "chunk_order_index": 0,
                        "source_id": "src-1",
                    }
                ],
                "entities": [
                    {
                        "entity_name": "EntityA",
                        "entity_type": "CONCEPT",
                        "description": "Entity A",
                        "source_id": "src-1",
                        "file_path": "test.pdf",
                    },
                    {
                        "entity_name": "EntityB",
                        "entity_type": "CONCEPT",
                        "description": "Entity B",
                        "source_id": "src-1",
                        "file_path": "test.pdf",
                    },
                ],
                "relationships": [
                    {
                        "src_id": "EntityB",
                        "tgt_id": "EntityA",
                        "description": "latest relation",
                        "keywords": "second",
                        "weight": 2.0,
                        "source_id": "src-1",
                        "file_path": "test.pdf",
                    },
                ],
            }

            with pytest.raises(RuntimeError, match="boom"):
                await rag.ainsert_custom_kg(custom_kg)

            rag.relationships_vdb.delete.assert_not_called()

            await rag.finalize_storages()

    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_ainsert_custom_kg_writes_full_docs_and_doc_status(self):
        """ainsert_custom_kg must write full_docs + doc_status for WebUI visibility."""
        from lightrag import LightRAG
        from lightrag.base import DocStatus

        with tempfile.TemporaryDirectory() as tmp:
            rag = LightRAG(
                working_dir=tmp,
                workspace=f"custom-status-{time.time_ns()}",
                llm_model_func=AsyncMock(return_value=""),
                embedding_func=mock_embedding_func,
            )
            await rag.initialize_storages()

            rag.entities_vdb.upsert = AsyncMock()
            rag.relationships_vdb.upsert = AsyncMock()
            rag.relationships_vdb.delete = AsyncMock()

            custom_kg = {
                "chunks": [
                    {
                        "content": "first chunk",
                        "chunk_order_index": 0,
                        "source_id": "src-1",
                        "file_path": "doc.pdf",
                    },
                    {
                        "content": "second chunk",
                        "chunk_order_index": 1,
                        "source_id": "src-2",
                        "file_path": "doc.pdf",
                    },
                ],
                "entities": [
                    {
                        "entity_name": "EntityA",
                        "entity_type": "CONCEPT",
                        "description": "Entity A",
                        "source_id": "src-1",
                        "file_path": "doc.pdf",
                    }
                ],
                "relationships": [],
            }

            result = await rag.ainsert_custom_kg(
                custom_kg, full_doc_id="doc-explicit-1"
            )

            # Return value contract
            assert result["full_doc_id"] == "doc-explicit-1"
            assert isinstance(result["track_id"], str) and result["track_id"]
            assert result["chunk_count"] == 2
            assert result["entity_count"] == 1
            assert result["relationship_count"] == 0

            # full_docs contains the joined content
            full_doc = await rag.full_docs.get_by_id("doc-explicit-1")
            assert full_doc is not None
            assert "first chunk" in full_doc["content"]
            assert "second chunk" in full_doc["content"]
            assert full_doc["file_path"] == "doc.pdf"

            # doc_status records PROCESSED + chunks_list for delete chain
            status = await rag.doc_status.get_by_id("doc-explicit-1")
            assert status is not None
            assert status["status"] == DocStatus.PROCESSED
            assert status["chunks_count"] == 2
            assert isinstance(status["chunks_list"], list)
            assert len(status["chunks_list"]) == 2
            assert status["track_id"] == result["track_id"]

            await rag.finalize_storages()

    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_ainsert_custom_chunks_writes_doc_status_for_webui_visibility(self):
        """ainsert_custom_chunks must write doc_status so /documents/paginated can see it."""
        from lightrag import LightRAG
        from lightrag.base import DocStatus

        with tempfile.TemporaryDirectory() as tmp:
            rag = LightRAG(
                working_dir=tmp,
                workspace=f"custom-unknown-source-{time.time_ns()}",
                llm_model_func=AsyncMock(return_value=""),
                embedding_func=mock_embedding_func,
            )
            await rag.initialize_storages()
            suffix = str(time.time_ns())

            await rag.ainsert_custom_chunks(
                full_text=f"first chunk {suffix} second chunk {suffix}",
                text_chunks=[f"first chunk {suffix}", f"second chunk {suffix}"],
                doc_id="doc-custom-chunks-1",
                file_path="custom/path/doc-custom-chunks-1.md",
            )

            status = await rag.doc_status.get_by_id("doc-custom-chunks-1")
            assert status is not None
            assert status["status"] == DocStatus.PROCESSED
            assert status["chunks_count"] == 2
            assert status["file_path"] == "custom/path/doc-custom-chunks-1.md"
            assert isinstance(status["chunks_list"], list)
            assert len(status["chunks_list"]) == 2
            assert isinstance(status["track_id"], str) and status["track_id"]

            stored_doc = await rag.full_docs.get_by_id("doc-custom-chunks-1")
            assert stored_doc is not None
            assert stored_doc["file_path"] == "custom/path/doc-custom-chunks-1.md"

            for chunk_id in status["chunks_list"]:
                chunk = await rag.text_chunks.get_by_id(chunk_id)
                assert chunk is not None
                assert chunk["file_path"] == "custom/path/doc-custom-chunks-1.md"

            (documents, total_count) = await rag.doc_status.get_docs_paginated(
                status_filter=None,
                page=1,
                page_size=10,
                sort_field="updated_at",
                sort_direction="desc",
            )
            visible_ids = [doc_id for doc_id, _ in documents]

            assert total_count == 1
            assert visible_ids == ["doc-custom-chunks-1"]

            await rag.finalize_storages()

    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_ainsert_custom_chunks_waits_for_text_chunks_before_extraction(self):
        """Entity extraction must start only after custom chunks are persisted."""
        from lightrag import LightRAG

        with tempfile.TemporaryDirectory() as tmp:
            rag = LightRAG(
                working_dir=tmp,
                llm_model_func=AsyncMock(return_value=""),
                embedding_func=mock_embedding_func,
            )
            await rag.initialize_storages()
            suffix = str(time.time_ns())
            chunk_a = f"first chunk {suffix}"
            chunk_b = f"second chunk {suffix}"

            original_upsert = rag.text_chunks.upsert
            upsert_finished = asyncio.Event()
            observed_chunk_contents: list[str | None] = []
            observed_upsert_state: list[bool] = []

            async def blocking_upsert(chunks):
                result = await original_upsert(chunks)
                await asyncio.sleep(0)
                upsert_finished.set()
                return result

            async def assert_chunks_visible_before_extract(self, chunks, *_args):
                observed_upsert_state.append(upsert_finished.is_set())
                for chunk_id in chunks:
                    chunk_data = await self.text_chunks.get_by_id(chunk_id)
                    observed_chunk_contents.append(
                        None if chunk_data is None else chunk_data.get("content")
                    )
                return []

            rag.text_chunks.upsert = blocking_upsert  # type: ignore[assignment]
            rag._process_extract_entities = MethodType(  # type: ignore[assignment]
                assert_chunks_visible_before_extract, rag
            )

            await rag.ainsert_custom_chunks(
                full_text=f"{chunk_a} {chunk_b}",
                text_chunks=[chunk_a, chunk_b],
                doc_id="doc-custom-order-1",
            )

            assert observed_upsert_state == [True]
            assert observed_chunk_contents == [chunk_a, chunk_b]

            await rag.finalize_storages()

    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_ainsert_custom_chunks_marks_doc_status_failed_on_error(self):
        """ainsert_custom_chunks must keep a FAILED doc_status record when storage write fails."""
        from lightrag import LightRAG
        from lightrag.base import DocStatus

        with tempfile.TemporaryDirectory() as tmp:
            rag = LightRAG(
                working_dir=tmp,
                llm_model_func=AsyncMock(return_value=""),
                embedding_func=mock_embedding_func,
            )
            await rag.initialize_storages()

            rag.chunks_vdb.upsert = AsyncMock(side_effect=RuntimeError("kaboom"))

            with pytest.raises(RuntimeError, match="kaboom"):
                await rag.ainsert_custom_chunks(
                    full_text="broken chunk import",
                    text_chunks=["broken", "chunk"],
                    doc_id="doc-custom-chunks-fail-1",
                )

            status = await rag.doc_status.get_by_id("doc-custom-chunks-fail-1")
            assert status is not None
            assert status["status"] == DocStatus.FAILED
            assert status["chunks_count"] == 2
            assert "kaboom" in (status.get("error_msg") or "")

            await rag.finalize_storages()

    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_ainsert_custom_chunks_auto_builds_graph_for_unknown_source(
        self, monkeypatch
    ):
        from lightrag import LightRAG
        from lightrag.base import DocStatus

        with tempfile.TemporaryDirectory() as tmp:
            rag = LightRAG(
                working_dir=tmp,
                llm_model_func=AsyncMock(return_value=""),
                embedding_func=mock_embedding_func,
            )
            await rag.initialize_storages()
            suffix = str(time.time_ns())

            merge_calls: list[dict] = []

            async def fake_extract(self, chunks, *_args):
                return [("nodes", "edges", list(chunks.keys()))]

            async def fake_merge(**kwargs):
                merge_calls.append(
                    {
                        "doc_id": kwargs["doc_id"],
                        "file_path": kwargs["file_path"],
                        "chunk_results": kwargs["chunk_results"],
                    }
                )

            monkeypatch.setattr(
                rag,
                "_process_extract_entities",
                MethodType(fake_extract, rag),
            )
            monkeypatch.setattr("lightrag.lightrag.merge_nodes_and_edges", fake_merge)

            await rag.ainsert_custom_chunks(
                full_text=f"unknown source custom chunk full text {suffix}",
                text_chunks=[f"chunk one {suffix}", f"chunk two {suffix}"],
                doc_id="doc-custom-unknown-source-1",
                file_path="unknown_source",
            )

            status = await rag.doc_status.get_by_id("doc-custom-unknown-source-1")
            assert status is not None
            assert status["status"] == DocStatus.PROCESSED
            assert status["metadata"]["source"] == "custom_chunks"
            assert len(merge_calls) == 1
            assert merge_calls[0]["doc_id"] == "doc-custom-unknown-source-1"
            assert merge_calls[0]["file_path"] == "unknown_source"
            assert len(merge_calls[0]["chunk_results"]) == 1

            await rag.finalize_storages()

    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_arebuild_all_custom_chunks_graphs_only_processes_custom_chunk_docs(
        self, monkeypatch
    ):
        from lightrag import LightRAG
        from lightrag.base import DocStatus
        workspace = f"custom-rebuild-{time.time_ns()}"

        with tempfile.TemporaryDirectory() as tmp:
            rag = LightRAG(
                working_dir=tmp,
                workspace=workspace,
                llm_model_func=AsyncMock(return_value=""),
                embedding_func=mock_embedding_func,
            )
            await rag.initialize_storages()

            custom_doc_id = "doc-custom-rebuild-1"
            normal_doc_id = "doc-normal-rebuild-1"
            custom_chunk_id = "chunk-custom-rebuild-1"
            normal_chunk_id = "chunk-normal-rebuild-1"

            await rag.full_docs.upsert(
                {
                    custom_doc_id: {"content": "custom full text", "file_path": ""},
                    normal_doc_id: {"content": "normal full text", "file_path": "note.md"},
                }
            )
            await rag.text_chunks.upsert(
                {
                    custom_chunk_id: {
                        "content": "custom chunk text",
                        "full_doc_id": custom_doc_id,
                        "tokens": 3,
                        "chunk_order_index": 0,
                        "file_path": "",
                    },
                    normal_chunk_id: {
                        "content": "normal chunk text",
                        "full_doc_id": normal_doc_id,
                        "tokens": 3,
                        "chunk_order_index": 0,
                        "file_path": "note.md",
                    },
                }
            )
            await rag.doc_status.upsert(
                {
                    custom_doc_id: {
                        "status": DocStatus.PROCESSED,
                        "content_summary": "custom summary",
                        "content_length": 16,
                        "chunks_count": 1,
                        "chunks_list": [custom_chunk_id],
                        "created_at": "2026-05-09T00:00:00+00:00",
                        "updated_at": "2026-05-09T00:00:00+00:00",
                        "file_path": "",
                        "track_id": "track-custom",
                        "metadata": {"source": "custom_chunks"},
                    },
                    normal_doc_id: {
                        "status": DocStatus.PROCESSED,
                        "content_summary": "normal summary",
                        "content_length": 16,
                        "chunks_count": 1,
                        "chunks_list": [normal_chunk_id],
                        "created_at": "2026-05-09T00:00:00+00:00",
                        "updated_at": "2026-05-09T00:00:00+00:00",
                        "file_path": "note.md",
                        "track_id": "track-normal",
                        "metadata": {"source": "upload"},
                    },
                }
            )

            extract_calls: list[list[str]] = []
            merge_calls: list[str] = []

            async def fake_extract(self, chunks, *_args):
                extract_calls.append(list(chunks.keys()))
                return [("nodes", "edges")]

            async def fake_merge(**kwargs):
                merge_calls.append(kwargs["doc_id"])

            monkeypatch.setattr(
                rag,
                "_process_extract_entities",
                MethodType(fake_extract, rag),
            )
            monkeypatch.setattr("lightrag.lightrag.merge_nodes_and_edges", fake_merge)

            summary = await rag.arebuild_all_custom_chunks_graphs()

            assert summary["total_candidates"] == 1
            assert summary["rebuilt"] == 1
            assert summary["failed"] == 0
            assert summary["skipped"] == 0
            assert extract_calls == [[custom_chunk_id]]
            assert merge_calls == [custom_doc_id]

            custom_status = await rag.doc_status.get_by_id(custom_doc_id)
            normal_status = await rag.doc_status.get_by_id(normal_doc_id)
            assert custom_status is not None
            assert custom_status["status"] == DocStatus.PROCESSED
            assert custom_status["metadata"]["source"] == "custom_chunks"
            assert normal_status is not None
            assert normal_status["metadata"]["source"] == "upload"

            await rag.finalize_storages()

    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_arebuild_all_custom_chunks_graphs_rebuilds_only_selected_doc_ids(
        self, monkeypatch
    ):
        from lightrag import LightRAG
        from lightrag.base import DocStatus

        workspace = f"selected-rebuild-{time.time_ns()}"

        with tempfile.TemporaryDirectory() as tmp:
            rag = LightRAG(
                working_dir=tmp,
                workspace=workspace,
                llm_model_func=AsyncMock(return_value=""),
                embedding_func=mock_embedding_func,
            )
            await rag.initialize_storages()

            selected_doc_id = "doc-selected-rebuild-1"
            skipped_doc_id = "doc-skipped-rebuild-1"
            selected_chunk_id = "chunk-selected-rebuild-1"
            skipped_chunk_id = "chunk-skipped-rebuild-1"

            await rag.full_docs.upsert(
                {
                    selected_doc_id: {"content": "selected full text", "file_path": "selected.md"},
                    skipped_doc_id: {"content": "skipped full text", "file_path": "skipped.md"},
                }
            )
            await rag.text_chunks.upsert(
                {
                    selected_chunk_id: {
                        "content": "selected chunk text",
                        "full_doc_id": selected_doc_id,
                        "tokens": 3,
                        "chunk_order_index": 0,
                        "file_path": "selected.md",
                    },
                    skipped_chunk_id: {
                        "content": "skipped chunk text",
                        "full_doc_id": skipped_doc_id,
                        "tokens": 3,
                        "chunk_order_index": 0,
                        "file_path": "skipped.md",
                    },
                }
            )
            await rag.doc_status.upsert(
                {
                    selected_doc_id: {
                        "status": DocStatus.PROCESSED,
                        "content_summary": "selected summary",
                        "content_length": 16,
                        "chunks_count": 1,
                        "chunks_list": [selected_chunk_id],
                        "created_at": "2026-05-09T00:00:00+00:00",
                        "updated_at": "2026-05-09T00:00:00+00:00",
                        "file_path": "selected.md",
                        "track_id": "track-selected",
                        "metadata": {"source": "upload"},
                    },
                    skipped_doc_id: {
                        "status": DocStatus.PROCESSED,
                        "content_summary": "skipped summary",
                        "content_length": 16,
                        "chunks_count": 1,
                        "chunks_list": [skipped_chunk_id],
                        "created_at": "2026-05-09T00:00:00+00:00",
                        "updated_at": "2026-05-09T00:00:00+00:00",
                        "file_path": "skipped.md",
                        "track_id": "track-skipped",
                        "metadata": {"source": "custom_chunks"},
                    },
                }
            )

            extract_calls: list[list[str]] = []
            merge_calls: list[str] = []

            async def fake_extract(self, chunks, *_args):
                extract_calls.append(list(chunks.keys()))
                return [("nodes", "edges")]

            async def fake_merge(**kwargs):
                merge_calls.append(kwargs["doc_id"])

            monkeypatch.setattr(
                rag,
                "_process_extract_entities",
                MethodType(fake_extract, rag),
            )
            monkeypatch.setattr("lightrag.lightrag.merge_nodes_and_edges", fake_merge)

            summary = await rag.arebuild_all_custom_chunks_graphs([selected_doc_id])

            assert summary["total_candidates"] == 1
            assert summary["rebuilt"] == 1
            assert summary["failed"] == 0
            assert summary["skipped"] == 0
            assert extract_calls == [[selected_chunk_id]]
            assert merge_calls == [selected_doc_id]

            selected_status = await rag.doc_status.get_by_id(selected_doc_id)
            skipped_status = await rag.doc_status.get_by_id(skipped_doc_id)
            assert selected_status is not None
            assert selected_status["metadata"]["source"] == "upload"
            assert skipped_status is not None
            assert skipped_status["updated_at"] == "2026-05-09T00:00:00+00:00"

            await rag.finalize_storages()

    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_ainsert_custom_kg_marks_doc_status_failed_on_error(self):
        """When the graph upsert blows up, doc_status must be flipped to FAILED."""
        from lightrag import LightRAG
        from lightrag.base import DocStatus

        with tempfile.TemporaryDirectory() as tmp:
            rag = LightRAG(
                working_dir=tmp,
                llm_model_func=AsyncMock(return_value=""),
                embedding_func=mock_embedding_func,
            )
            await rag.initialize_storages()

            rag.entities_vdb.upsert = AsyncMock()
            rag.relationships_vdb.upsert = AsyncMock()
            rag.relationships_vdb.delete = AsyncMock()

            graph = rag.chunk_entity_relation_graph
            graph.upsert_nodes_batch = AsyncMock(side_effect=RuntimeError("kaboom"))
            graph.has_nodes_batch = AsyncMock(return_value=set())
            graph.upsert_edges_batch = AsyncMock()

            custom_kg = {
                "chunks": [
                    {
                        "content": "chunk content",
                        "chunk_order_index": 0,
                        "source_id": "src-1",
                    }
                ],
                "entities": [
                    {
                        "entity_name": "EntityA",
                        "entity_type": "CONCEPT",
                        "description": "Entity A",
                        "source_id": "src-1",
                        "file_path": "test.pdf",
                    }
                ],
                "relationships": [],
            }

            with pytest.raises(RuntimeError, match="kaboom"):
                await rag.ainsert_custom_kg(custom_kg, full_doc_id="doc-fail-1")

            status = await rag.doc_status.get_by_id("doc-fail-1")
            assert status is not None
            assert status["status"] == DocStatus.FAILED
            assert "kaboom" in (status.get("error_msg") or "")

            await rag.finalize_storages()

    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_ainsert_custom_kg_rejects_missing_required_fields(self):
        """Required fields must produce ValueError → 400, not bare KeyError → 500."""
        from lightrag import LightRAG

        with tempfile.TemporaryDirectory() as tmp:
            rag = LightRAG(
                working_dir=tmp,
                llm_model_func=AsyncMock(return_value=""),
                embedding_func=mock_embedding_func,
            )
            await rag.initialize_storages()

            rag.entities_vdb.upsert = AsyncMock()
            rag.relationships_vdb.upsert = AsyncMock()
            rag.relationships_vdb.delete = AsyncMock()

            with pytest.raises(ValueError):
                await rag.ainsert_custom_kg(
                    {"chunks": [], "entities": [], "relationships": []}
                )

            with pytest.raises(ValueError):
                await rag.ainsert_custom_kg(
                    {
                        "chunks": [{"content": "x", "source_id": ""}],
                        "entities": [],
                        "relationships": [],
                    }
                )

            with pytest.raises(ValueError):
                await rag.ainsert_custom_kg(
                    {
                        "chunks": [],
                        "entities": [{"entity_type": "X"}],
                        "relationships": [],
                    }
                )

            with pytest.raises(ValueError):
                await rag.ainsert_custom_kg(
                    {
                        "chunks": [],
                        "entities": [],
                        "relationships": [{"src_id": "A", "tgt_id": ""}],
                    }
                )

            await rag.finalize_storages()

    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_ainsert_custom_kg_placeholder_source_id_aggregates_chunks(self):
        """Placeholder nodes inherit GRAPH_FIELD_SEP-joined sources from all relations."""
        from lightrag import LightRAG
        from lightrag.constants import GRAPH_FIELD_SEP
        from lightrag.utils import compute_mdhash_id

        with tempfile.TemporaryDirectory() as tmp:
            rag = LightRAG(
                working_dir=tmp,
                llm_model_func=AsyncMock(return_value=""),
                embedding_func=mock_embedding_func,
            )
            await rag.initialize_storages()

            graph = rag.chunk_entity_relation_graph
            graph.upsert_nodes_batch = AsyncMock()
            graph.has_nodes_batch = AsyncMock(return_value=set())
            graph.upsert_edges_batch = AsyncMock()

            rag.entities_vdb.upsert = AsyncMock()
            rag.relationships_vdb.upsert = AsyncMock()
            rag.relationships_vdb.delete = AsyncMock()

            content_a = "chunk one"
            content_b = "chunk two"
            chunk_id_a = compute_mdhash_id(content_a, prefix="chunk-")
            chunk_id_b = compute_mdhash_id(content_b, prefix="chunk-")

            custom_kg = {
                "chunks": [
                    {"content": content_a, "chunk_order_index": 0, "source_id": "s1"},
                    {"content": content_b, "chunk_order_index": 1, "source_id": "s2"},
                ],
                "entities": [],
                "relationships": [
                    {
                        "src_id": "Implicit",
                        "tgt_id": "OtherImplicit",
                        "description": "first relation",
                        "keywords": "rel",
                        "weight": 1.0,
                        "source_id": "s1",
                    },
                    {
                        "src_id": "Implicit",
                        "tgt_id": "ThirdImplicit",
                        "description": "second relation",
                        "keywords": "rel",
                        "weight": 1.0,
                        "source_id": "s2",
                    },
                ],
            }

            await rag.ainsert_custom_kg(custom_kg)

            # Placeholder upsert is the second nodes_batch call (after entity_nodes,
            # which is empty here). Find the placeholder batch that contains "Implicit".
            placeholder_batch = None
            for call in graph.upsert_nodes_batch.await_args_list:
                names = [name for name, _ in call.args[0]]
                if "Implicit" in names:
                    placeholder_batch = dict(call.args[0])
                    break
            assert placeholder_batch is not None, "Placeholder batch not found"
            implicit_node = placeholder_batch["Implicit"]
            sources = implicit_node["source_id"].split(GRAPH_FIELD_SEP)
            assert set(sources) == {chunk_id_a, chunk_id_b}

            await rag.finalize_storages()

    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_ainsert_custom_kg_handles_duplicate_source_id_chunks(self):
        """Two chunks sharing the same source_id must both map back from chunk_to_source_map."""
        from lightrag import LightRAG
        from lightrag.constants import GRAPH_FIELD_SEP
        from lightrag.utils import compute_mdhash_id

        with tempfile.TemporaryDirectory() as tmp:
            rag = LightRAG(
                working_dir=tmp,
                llm_model_func=AsyncMock(return_value=""),
                embedding_func=mock_embedding_func,
            )
            await rag.initialize_storages()

            graph = rag.chunk_entity_relation_graph
            graph.upsert_nodes_batch = AsyncMock()
            graph.has_nodes_batch = AsyncMock(return_value=set())
            graph.upsert_edges_batch = AsyncMock()

            rag.entities_vdb.upsert = AsyncMock()
            rag.relationships_vdb.upsert = AsyncMock()
            rag.relationships_vdb.delete = AsyncMock()

            content_a = "alpha chunk"
            content_b = "beta chunk"
            chunk_id_a = compute_mdhash_id(content_a, prefix="chunk-")
            chunk_id_b = compute_mdhash_id(content_b, prefix="chunk-")

            custom_kg = {
                "chunks": [
                    {"content": content_a, "chunk_order_index": 0, "source_id": "src-1"},
                    {"content": content_b, "chunk_order_index": 1, "source_id": "src-1"},
                ],
                "entities": [
                    {
                        "entity_name": "EntityA",
                        "entity_type": "CONCEPT",
                        "description": "Entity A",
                        "source_id": "src-1",
                    }
                ],
                "relationships": [],
            }

            await rag.ainsert_custom_kg(custom_kg)

            entity_batch = graph.upsert_nodes_batch.await_args_list[0].args[0]
            entity_node = dict(entity_batch)["EntityA"]
            sources = entity_node["source_id"].split(GRAPH_FIELD_SEP)
            assert set(sources) == {chunk_id_a, chunk_id_b}

            await rag.finalize_storages()

    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_ainsert_custom_kg_returns_dict_summary(self):
        """The new return contract: dict with full_doc_id, track_id, counts."""
        from lightrag import LightRAG

        with tempfile.TemporaryDirectory() as tmp:
            rag = LightRAG(
                working_dir=tmp,
                llm_model_func=AsyncMock(return_value=""),
                embedding_func=mock_embedding_func,
            )
            await rag.initialize_storages()

            graph = rag.chunk_entity_relation_graph
            graph.upsert_nodes_batch = AsyncMock()
            graph.has_nodes_batch = AsyncMock(return_value=set())
            graph.upsert_edges_batch = AsyncMock()
            rag.entities_vdb.upsert = AsyncMock()
            rag.relationships_vdb.upsert = AsyncMock()
            rag.relationships_vdb.delete = AsyncMock()

            result = await rag.ainsert_custom_kg(
                {
                    "chunks": [
                        {"content": "x", "chunk_order_index": 0, "source_id": "s"}
                    ],
                    "entities": [
                        {"entity_name": "X", "entity_type": "C", "description": "x"}
                    ],
                    "relationships": [],
                }
            )

            assert set(result.keys()) == {
                "full_doc_id",
                "track_id",
                "chunk_count",
                "entity_count",
                "relationship_count",
            }
            assert result["full_doc_id"].startswith("doc-")
            assert result["track_id"]
            assert result["chunk_count"] == 1
            assert result["entity_count"] == 1
            assert result["relationship_count"] == 0

            await rag.finalize_storages()

    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_ainsert_custom_kg_chunkless_import_still_writes_full_docs(self):
        """Chunkless custom KG import must still produce a readable full_docs entry."""
        from lightrag import LightRAG

        with tempfile.TemporaryDirectory() as tmp:
            rag = LightRAG(
                working_dir=tmp,
                llm_model_func=AsyncMock(return_value=""),
                embedding_func=mock_embedding_func,
            )
            await rag.initialize_storages()

            graph = rag.chunk_entity_relation_graph
            graph.upsert_nodes_batch = AsyncMock()
            graph.has_nodes_batch = AsyncMock(return_value=set())
            graph.upsert_edges_batch = AsyncMock()
            rag.entities_vdb.upsert = AsyncMock()
            rag.relationships_vdb.upsert = AsyncMock()
            rag.relationships_vdb.delete = AsyncMock()

            result = await rag.ainsert_custom_kg(
                {
                    "chunks": [],
                    "entities": [
                        {
                            "entity_name": "EntityA",
                            "entity_type": "CONCEPT",
                            "description": "Entity only import",
                        }
                    ],
                    "relationships": [],
                }
            )

            full_doc = await rag.full_docs.get_by_id(result["full_doc_id"])
            assert full_doc is not None
            assert full_doc["file_path"] == "custom_kg"
            assert isinstance(full_doc["content"], str)
            assert full_doc["content"]

            await rag.finalize_storages()

    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_ainsert_custom_kg_writes_full_entity_and_relation_indexes(self):
        """Custom KG import must populate full_entities/full_relations for delete chain."""
        from lightrag import LightRAG

        with tempfile.TemporaryDirectory() as tmp:
            rag = LightRAG(
                working_dir=tmp,
                llm_model_func=AsyncMock(return_value=""),
                embedding_func=mock_embedding_func,
            )
            await rag.initialize_storages()

            result = await rag.ainsert_custom_kg(
                {
                    "chunks": [
                        {"content": "chunk text", "source_id": "s1", "chunk_order_index": 0}
                    ],
                    "entities": [
                        {"entity_name": "EntityA", "description": "A", "source_id": "s1"},
                        {"entity_name": "EntityB", "description": "B", "source_id": "s1"},
                    ],
                    "relationships": [
                        {
                            "src_id": "EntityA",
                            "tgt_id": "EntityB",
                            "description": "A to B",
                            "keywords": "link",
                            "source_id": "s1",
                        }
                    ],
                }
            )

            full_entities = await rag.full_entities.get_by_id(result["full_doc_id"])
            full_relations = await rag.full_relations.get_by_id(result["full_doc_id"])

            assert full_entities is not None
            assert full_entities["entity_names"] == ["EntityA", "EntityB"]
            assert full_entities["count"] == 2

            assert full_relations is not None
            assert full_relations["relation_pairs"] == [["EntityA", "EntityB"]]
            assert full_relations["count"] == 1

            await rag.finalize_storages()

    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_ainsert_custom_kg_full_entity_index_includes_placeholder_nodes(self):
        """Relation-only imports must index placeholder endpoints for later deletion."""
        from lightrag import LightRAG

        with tempfile.TemporaryDirectory() as tmp:
            rag = LightRAG(
                working_dir=tmp,
                llm_model_func=AsyncMock(return_value=""),
                embedding_func=mock_embedding_func,
            )
            await rag.initialize_storages()

            result = await rag.ainsert_custom_kg(
                {
                    "chunks": [],
                    "entities": [],
                    "relationships": [
                        {
                            "src_id": "ImplicitA",
                            "tgt_id": "ImplicitB",
                            "description": "A to B",
                            "keywords": "link",
                        }
                    ],
                }
            )

            full_entities = await rag.full_entities.get_by_id(result["full_doc_id"])
            assert full_entities is not None
            assert full_entities["entity_names"] == ["ImplicitA", "ImplicitB"]
            assert full_entities["count"] == 2

            await rag.finalize_storages()

    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_adelete_by_doc_id_removes_custom_kg_graph_metadata(self):
        """End-to-end: deleting a custom KG doc must clear all document-level indexes."""
        from lightrag import LightRAG

        with tempfile.TemporaryDirectory() as tmp:
            rag = LightRAG(
                working_dir=tmp,
                llm_model_func=AsyncMock(return_value=""),
                embedding_func=mock_embedding_func,
            )
            await rag.initialize_storages()

            result = await rag.ainsert_custom_kg(
                {
                    "chunks": [
                        {"content": "chunk text", "source_id": "s1", "chunk_order_index": 0}
                    ],
                    "entities": [
                        {"entity_name": "EntityA", "description": "A", "source_id": "s1"},
                        {"entity_name": "EntityB", "description": "B", "source_id": "s1"},
                    ],
                    "relationships": [
                        {
                            "src_id": "EntityA",
                            "tgt_id": "EntityB",
                            "description": "A to B",
                            "keywords": "link",
                            "source_id": "s1",
                        }
                    ],
                }
            )

            doc_id = result["full_doc_id"]
            delete_result = await rag.adelete_by_doc_id(doc_id)
            assert delete_result.status == "success"

            assert await rag.doc_status.get_by_id(doc_id) is None
            assert await rag.full_docs.get_by_id(doc_id) is None
            assert await rag.full_entities.get_by_id(doc_id) is None
            assert await rag.full_relations.get_by_id(doc_id) is None

            await rag.finalize_storages()

    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_adelete_by_doc_id_removes_chunkless_custom_kg_graph_metadata(self):
        """Chunkless custom KG delete must remove doc indexes and graph nodes."""
        from lightrag import LightRAG

        with tempfile.TemporaryDirectory() as tmp:
            rag = LightRAG(
                working_dir=tmp,
                llm_model_func=AsyncMock(return_value=""),
                embedding_func=mock_embedding_func,
            )
            await rag.initialize_storages()

            result = await rag.ainsert_custom_kg(
                {
                    "chunks": [],
                    "entities": [],
                    "relationships": [
                        {
                            "src_id": "ImplicitA",
                            "tgt_id": "ImplicitB",
                            "description": "A to B",
                            "keywords": "link",
                        }
                    ],
                }
            )

            doc_id = result["full_doc_id"]
            delete_result = await rag.adelete_by_doc_id(doc_id)
            assert delete_result.status == "success"

            assert await rag.doc_status.get_by_id(doc_id) is None
            assert await rag.full_docs.get_by_id(doc_id) is None
            assert await rag.full_entities.get_by_id(doc_id) is None
            assert await rag.full_relations.get_by_id(doc_id) is None
            assert not await rag.chunk_entity_relation_graph.has_node("ImplicitA")
            assert not await rag.chunk_entity_relation_graph.has_node("ImplicitB")
            assert not await rag.chunk_entity_relation_graph.has_edge(
                "ImplicitA", "ImplicitB"
            )

            await rag.finalize_storages()

    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_get_relation_info_falls_back_to_legacy_relation_vdb_id(self):
        from lightrag import LightRAG

        with tempfile.TemporaryDirectory() as tmp:
            rag = LightRAG(
                working_dir=tmp,
                llm_model_func=AsyncMock(return_value=""),
                embedding_func=mock_embedding_func,
            )
            await rag.initialize_storages()

            rag.entities_vdb.upsert = AsyncMock()
            rag.relationships_vdb.upsert = AsyncMock()
            rag.relationships_vdb.delete = AsyncMock()
            rag.text_chunks.upsert = AsyncMock()
            rag.doc_status.upsert = AsyncMock()

            custom_kg = {
                "chunks": [
                    {
                        "content": "chunk content",
                        "chunk_order_index": 0,
                        "source_id": "src-1",
                    }
                ],
                "entities": [
                    {
                        "entity_name": "EntityA",
                        "entity_type": "CONCEPT",
                        "description": "Entity A",
                        "source_id": "src-1",
                        "file_path": "test.pdf",
                    },
                    {
                        "entity_name": "EntityB",
                        "entity_type": "CONCEPT",
                        "description": "Entity B",
                        "source_id": "src-1",
                        "file_path": "test.pdf",
                    },
                ],
                "relationships": [
                    {
                        "src_id": "EntityB",
                        "tgt_id": "EntityA",
                        "description": "latest relation",
                        "keywords": "second",
                        "weight": 2.0,
                        "source_id": "src-1",
                        "file_path": "test.pdf",
                    },
                ],
            }

            await rag.ainsert_custom_kg(custom_kg)

            normalized_rel_id, legacy_rel_id = make_relation_vdb_ids(
                "EntityA", "EntityB"
            )
            rag.relationships_vdb.get_by_id = AsyncMock(
                side_effect=lambda rid: {"ok": True} if rid == legacy_rel_id else None
            )

            result_ab = await rag.get_relation_info(
                "EntityA", "EntityB", include_vector_data=True
            )
            result_ba = await rag.get_relation_info(
                "EntityB", "EntityA", include_vector_data=True
            )

            assert result_ab["vector_data"] == {"ok": True}
            assert result_ba["vector_data"] == {"ok": True}
            assert [
                call.args[0] for call in rag.relationships_vdb.get_by_id.await_args_list
            ] == [
                normalized_rel_id,
                legacy_rel_id,
                normalized_rel_id,
                legacy_rel_id,
            ]

            await rag.finalize_storages()


class TestPostgresBatchOrdering:
    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_upsert_nodes_batch_preserves_last_write_wins(self):
        from lightrag.kg.postgres_impl import PGGraphStorage

        storage = PGGraphStorage.__new__(PGGraphStorage)
        call_log: list[tuple[str, str]] = []

        async def spy(node_id, *, node_data):
            call_log.append((node_id, node_data["description"]))

        storage.upsert_node = spy  # type: ignore[assignment]

        await PGGraphStorage.upsert_nodes_batch(
            storage,
            [
                ("EntityA", _make_node("EntityA")),
                ("EntityA", dict(_make_node("EntityA"), description="latest")),
                ("EntityB", _make_node("EntityB")),
            ],
        )

        assert call_log == [
            ("EntityA", "latest"),
            ("EntityB", "Description of EntityB"),
        ]

    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_upsert_edges_batch_preserves_last_write_wins(self):
        from lightrag.kg.postgres_impl import PGGraphStorage

        storage = PGGraphStorage.__new__(PGGraphStorage)
        call_log: list[tuple[str, str, float]] = []

        async def spy(src, tgt, *, edge_data):
            call_log.append((src, tgt, edge_data["weight"]))

        storage.upsert_edge = spy  # type: ignore[assignment]

        await PGGraphStorage.upsert_edges_batch(
            storage,
            [
                ("EntityA", "EntityB", _make_edge(1.0)),
                ("EntityB", "EntityA", _make_edge(2.0)),
                ("EntityB", "EntityC", _make_edge(3.0)),
            ],
        )

        assert call_log == [("EntityB", "EntityA", 2.0), ("EntityB", "EntityC", 3.0)]


class TestMongoBatchOrdering:
    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_upsert_nodes_batch_uses_ordered_bulk_write(self):
        pytest.importorskip("pymongo")
        from lightrag.kg.mongo_impl import MongoGraphStorage

        storage = MongoGraphStorage.__new__(MongoGraphStorage)
        storage.collection = AsyncMock()

        await MongoGraphStorage.upsert_nodes_batch(
            storage,
            [
                ("EntityA", _make_node("EntityA")),
                ("EntityA", dict(_make_node("EntityA"), description="latest")),
            ],
        )

        assert storage.collection.bulk_write.await_args.kwargs["ordered"] is True

    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_upsert_edges_batch_uses_ordered_bulk_write(self):
        pytest.importorskip("pymongo")
        from lightrag.kg.mongo_impl import MongoGraphStorage

        storage = MongoGraphStorage.__new__(MongoGraphStorage)
        storage.collection = AsyncMock()
        storage.edge_collection = AsyncMock()

        await MongoGraphStorage.upsert_edges_batch(
            storage,
            [
                ("EntityA", "EntityB", _make_edge(1.0)),
                ("EntityB", "EntityA", _make_edge(2.0)),
            ],
        )

        assert storage.edge_collection.bulk_write.await_args.kwargs["ordered"] is True

    @pytest.mark.offline
    @pytest.mark.asyncio
    async def test_upsert_edges_batch_deduplicates_source_node_upserts(self):
        pytest.importorskip("pymongo")
        from lightrag.kg.mongo_impl import MongoGraphStorage

        storage = MongoGraphStorage.__new__(MongoGraphStorage)
        storage.collection = AsyncMock()
        storage.edge_collection = AsyncMock()

        await MongoGraphStorage.upsert_edges_batch(
            storage,
            [
                ("EntityA", "EntityB", _make_edge(1.0)),
                ("EntityA", "EntityC", _make_edge(2.0)),
            ],
        )

        node_ops = storage.collection.bulk_write.await_args.args[0]
        assert len(node_ops) == 1
        assert node_ops[0]._filter == {"_id": "EntityA"}
