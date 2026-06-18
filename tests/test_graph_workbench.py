from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

import lightrag.api.graph_workbench as graph_workbench
from lightrag.api.graph_workbench import (
    LOW_WEIGHT_EDGE_THRESHOLD,
    get_legacy_graph_payload,
    query_graph_workbench,
)
from lightrag.lightrag import LightRAG
from lightrag import utils_graph

pytestmark = pytest.mark.offline


class _DummyRAG:
    def __init__(
        self,
        graph_payload: dict[str, Any],
        runtime_max_graph_nodes: int | None = None,
        backend_max_graph_nodes: int | None = None,
    ) -> None:
        self.graph_payload = graph_payload
        self.max_graph_nodes = runtime_max_graph_nodes
        self.chunk_entity_relation_graph = SimpleNamespace(
            global_config=(
                {"max_graph_nodes": backend_max_graph_nodes}
                if backend_max_graph_nodes is not None
                else {}
            )
        )
        self.last_graph_call: dict[str, Any] | None = None

    async def get_knowledge_graph(
        self,
        node_label: str,
        max_depth: int,
        max_nodes: int,
        direction: str = "both",
    ) -> dict[str, Any]:
        self.last_graph_call = {
            "node_label": node_label,
            "max_depth": max_depth,
            "max_nodes": max_nodes,
            "direction": direction,
        }
        return self.graph_payload


class _CaptureGraphStorage:
    def __init__(self, result: Any) -> None:
        self.result = result
        self.calls: list[dict[str, Any]] = []

    async def get_knowledge_graph(
        self,
        node_label: str,
        max_depth: int = 3,
        max_nodes: int = 1000,
        direction: str = "both",
    ) -> Any:
        self.calls.append(
            {
                "node_label": node_label,
                "max_depth": max_depth,
                "max_nodes": max_nodes,
                "direction": direction,
            }
        )
        return self.result


def _node(node_id: str, entity_type: str, description: str = "") -> dict[str, Any]:
    return {
        "id": node_id,
        "labels": [entity_type],
        "properties": {
            "entity_type": entity_type,
            "description": description,
        },
    }


def _edge(
    edge_id: str,
    source: str,
    target: str,
    relation_type: str,
    keywords: str = "",
    weight: float = 1.0,
    source_id: str = "",
    file_path: str = "",
) -> dict[str, Any]:
    return {
        "id": edge_id,
        "type": relation_type,
        "source": source,
        "target": target,
        "properties": {
            "relation_type": relation_type,
            "keywords": keywords,
            "weight": weight,
            "source_id": source_id,
            "file_path": file_path,
        },
    }


@pytest.mark.asyncio
async def test_lightrag_get_knowledge_graph_forwards_direction_to_storage():
    storage = _CaptureGraphStorage(result={"nodes": [], "edges": []})
    rag = LightRAG.__new__(LightRAG)
    rag.max_graph_nodes = 50
    rag.chunk_entity_relation_graph = storage

    result = await rag.get_knowledge_graph(
        "Tesla", max_depth=2, max_nodes=128, direction="outbound"
    )

    assert storage.calls == [
        {
            "node_label": "Tesla",
            "max_depth": 2,
            "max_nodes": 50,
            "direction": "outbound",
        }
    ]
    assert result == {"nodes": [], "edges": []}


@pytest.mark.asyncio
async def test_query_bounded_base_graph_filtering_and_node_filtering():
    rag = _DummyRAG(
        graph_payload={
            "nodes": [
                _node("n1", "PERSON"),
                _node("n2", "ORGANIZATION"),
                _node("n3", "PERSON"),
            ],
            "edges": [],
            "is_truncated": False,
        },
        runtime_max_graph_nodes=2,
    )

    result = await query_graph_workbench(
        rag,
        {
            "scope": {"label": "*", "max_depth": 2, "max_nodes": 10},
            "node_filters": {"entity_types": ["PERSON"]},
        },
    )

    assert rag.last_graph_call == {
        "node_label": "*",
        "max_depth": 2,
        "max_nodes": 2,
        "direction": "both",
    }
    assert result["truncation"]["effective_max_nodes"] == 2
    assert [node["id"] for node in result["data"]["nodes"]] == ["n1", "n3"]


@pytest.mark.asyncio
async def test_query_v1_and_or_semantics_for_group_and_field_and_array_or():
    rag = _DummyRAG(
        graph_payload={
            "nodes": [
                _node("n1", "PERSON", "founder"),
                _node("n2", "ORGANIZATION", "founder team"),
                _node("n3", "LOCATION", "hq"),
            ],
            "edges": [
                _edge(
                    "e1",
                    "n1",
                    "n2",
                    "owns",
                    keywords="equity stake",
                    weight=0.7,
                    source_id="doc-1",
                    file_path="/a.md",
                ),
                _edge(
                    "e2",
                    "n2",
                    "n3",
                    "located_in",
                    keywords="hq",
                    weight=0.9,
                    source_id="doc-2",
                    file_path="/b.md",
                ),
            ],
            "is_truncated": False,
        }
    )

    result = await query_graph_workbench(
        rag,
        {
            "scope": {"label": "*", "max_depth": 2, "max_nodes": 100},
            "node_filters": {
                "entity_types": ["PERSON", "ORGANIZATION"],
                "description_query": "founder",
            },
            "edge_filters": {
                "relation_types": ["owns", "acquires"],
                "keyword_query": "equity",
                "weight_min": 0.5,
            },
            "source_filters": {
                "source_id_query": "doc-1",
                "file_paths": ["/a.md", "/x.md"],
            },
        },
    )

    assert {node["id"] for node in result["data"]["nodes"]} == {"n1", "n2"}
    assert [edge["id"] for edge in result["data"]["edges"]] == ["e1"]


@pytest.mark.asyncio
async def test_query_normalizes_unknown_graph_fields_into_custom_properties():
    rag = _DummyRAG(
        graph_payload={
            "nodes": [
                {
                    "id": "n1",
                    "labels": ["PERSON"],
                    "properties": {
                        "entity_id": "n1",
                        "entity_type": "PERSON",
                        "description": "founder",
                        "department": "research",
                    },
                }
            ],
            "edges": [
                {
                    "id": "e1",
                    "source": "n1",
                    "target": "n1",
                    "type": "works_on",
                    "properties": {
                        "src_id": "n1",
                        "tgt_id": "n1",
                        "description": "works on",
                        "keywords": "ai",
                        "confidence": 0.9,
                    },
                }
            ],
            "is_truncated": False,
        }
    )

    result = await query_graph_workbench(
        rag,
        {"scope": {"label": "*", "max_depth": 1, "max_nodes": 10}},
    )

    node = result["data"]["nodes"][0]
    edge = result["data"]["edges"][0]
    assert node["properties"]["custom_properties"] == {"department": "research"}
    assert node["graph_data"]["custom_properties"] == {"department": "research"}
    assert edge["properties"]["custom_properties"] == {"confidence": 0.9}
    assert edge["graph_data"]["custom_properties"] == {"confidence": 0.9}


@pytest.mark.asyncio
async def test_query_scope_direction_outbound_keeps_only_descendants():
    rag = _DummyRAG(
        graph_payload={
            "nodes": [
                _node("A", "ORGANIZATION"),
                _node("B", "PERSON"),
                _node("C", "PRODUCT"),
                _node("P", "PERSON"),
                _node("D", "LOCATION"),
            ],
            "edges": [
                _edge("e-parent", "P", "A", "parent_of"),
                _edge("e-out-1", "A", "B", "owns"),
                _edge("e-out-2", "B", "C", "builds"),
                _edge("e-in-2", "D", "A", "located_in"),
            ],
            "is_truncated": False,
        }
    )

    result = await query_graph_workbench(
        rag,
        {
            "scope": {
                "label": "A",
                "max_depth": 2,
                "max_nodes": 20,
                "direction": "outbound",
            }
        },
    )

    assert rag.last_graph_call == {
        "node_label": "A",
        "max_depth": 2,
        "max_nodes": 20,
        "direction": "outbound",
    }
    assert {node["id"] for node in result["data"]["nodes"]} == {"A", "B", "C"}
    assert {edge["id"] for edge in result["data"]["edges"]} == {"e-out-1", "e-out-2"}


@pytest.mark.asyncio
async def test_query_scope_direction_inbound_keeps_only_ancestors():
    rag = _DummyRAG(
        graph_payload={
            "nodes": [
                _node("A", "ORGANIZATION"),
                _node("B", "PERSON"),
                _node("C", "PRODUCT"),
                _node("P", "PERSON"),
                _node("D", "LOCATION"),
            ],
            "edges": [
                _edge("e-parent", "P", "A", "parent_of"),
                _edge("e-out-1", "A", "B", "owns"),
                _edge("e-out-2", "B", "C", "builds"),
                _edge("e-in-2", "D", "A", "located_in"),
            ],
            "is_truncated": False,
        }
    )

    result = await query_graph_workbench(
        rag,
        {
            "scope": {
                "label": "A",
                "max_depth": 2,
                "max_nodes": 20,
                "direction": "inbound",
            }
        },
    )

    assert rag.last_graph_call == {
        "node_label": "A",
        "max_depth": 2,
        "max_nodes": 20,
        "direction": "inbound",
    }
    assert {node["id"] for node in result["data"]["nodes"]} == {"A", "P", "D"}
    assert {edge["id"] for edge in result["data"]["edges"]} == {"e-parent", "e-in-2"}


@pytest.mark.asyncio
async def test_query_parses_stringified_custom_properties():
    rag = _DummyRAG(
        graph_payload={
            "nodes": [
                {
                    "id": "n1",
                    "labels": ["PERSON"],
                    "properties": {
                        "entity_id": "n1",
                        "entity_type": "PERSON",
                        "custom_properties": '{"department":"research","level":2}',
                    },
                }
            ],
            "edges": [
                {
                    "id": "e1",
                    "source": "n1",
                    "target": "n1",
                    "type": "works_on",
                    "properties": {
                        "src_id": "n1",
                        "tgt_id": "n1",
                        "custom_properties": '{"confidence":0.9}',
                    },
                }
            ],
            "is_truncated": False,
        }
    )

    result = await query_graph_workbench(
        rag,
        {"scope": {"label": "*", "max_depth": 1, "max_nodes": 10}},
    )

    node = result["data"]["nodes"][0]
    edge = result["data"]["edges"][0]
    assert node["properties"]["custom_properties"] == {
        "department": "research",
        "level": 2,
    }
    assert edge["properties"]["custom_properties"] == {"confidence": 0.9}


@pytest.mark.asyncio
async def test_truncation_flags_when_base_graph_already_truncated():
    rag = _DummyRAG(
        graph_payload={
            "nodes": [_node("n1", "PERSON"), _node("n2", "PERSON")],
            "edges": [],
            "is_truncated": True,
        }
    )

    result = await query_graph_workbench(
        rag,
        {"scope": {"label": "*", "max_depth": 1, "max_nodes": 10}},
    )

    assert result["truncation"]["was_truncated_before_filtering"] is True
    assert result["truncation"]["was_truncated_after_filtering"] is True


@pytest.mark.asyncio
async def test_truncation_flags_when_only_after_filtering_truncated():
    rag = _DummyRAG(
        graph_payload={
            "nodes": [_node("n1", "PERSON"), _node("n2", "PERSON"), _node("n3", "PERSON")],
            "edges": [],
            "is_truncated": False,
        },
        runtime_max_graph_nodes=2,
    )

    result = await query_graph_workbench(
        rag,
        {"scope": {"label": "*", "max_depth": 1, "max_nodes": 10}},
    )

    assert result["truncation"]["was_truncated_before_filtering"] is False
    assert result["truncation"]["was_truncated_after_filtering"] is True
    assert len(result["data"]["nodes"]) == 2


@pytest.mark.asyncio
async def test_effective_max_nodes_never_exceeds_runtime_or_backend_limit():
    rag = _DummyRAG(
        graph_payload={"nodes": [_node("n1", "PERSON")], "edges": [], "is_truncated": False},
        runtime_max_graph_nodes=50,
        backend_max_graph_nodes=20,
    )

    result = await query_graph_workbench(
        rag,
        {"scope": {"label": "*", "max_depth": 1, "max_nodes": 100}},
    )

    assert result["truncation"]["requested_max_nodes"] == 100
    assert result["truncation"]["effective_max_nodes"] == 20
    assert rag.last_graph_call == {
        "node_label": "*",
        "max_depth": 1,
        "max_nodes": 20,
        "direction": "both",
    }


@pytest.mark.asyncio
async def test_query_time_filters_support_mixed_timezone_and_naive_boundaries():
    rag = _DummyRAG(
        graph_payload={
            "nodes": [_node("n1", "PERSON"), _node("n2", "ORGANIZATION")],
            "edges": [
                _edge(
                    "e1",
                    "n1",
                    "n2",
                    "works_for",
                    source_id="doc-1",
                    file_path="/a.md",
                )
            ],
            "is_truncated": False,
        }
    )
    rag.graph_payload["edges"][0]["properties"]["time"] = "2026-01-01T00:00:00"

    result = await query_graph_workbench(
        rag,
        {
            "scope": {"label": "*", "max_depth": 1, "max_nodes": 10},
            "source_filters": {
                "time_from": "2026-01-01T00:00:00+00:00",
                "time_to": "2025-12-31T16:00:00-08:00",
            },
        },
    )

    assert [edge["id"] for edge in result["data"]["edges"]] == ["e1"]


@pytest.mark.asyncio
async def test_query_hide_low_weight_edges_uses_explicit_threshold_semantics():
    rag = _DummyRAG(
        graph_payload={
            "nodes": [_node("n1", "PERSON"), _node("n2", "ORGANIZATION")],
            "edges": [
                _edge("e-low", "n1", "n2", "works_for", weight=LOW_WEIGHT_EDGE_THRESHOLD),
                _edge(
                    "e-high",
                    "n1",
                    "n2",
                    "works_for",
                    weight=LOW_WEIGHT_EDGE_THRESHOLD + 0.01,
                ),
            ],
            "is_truncated": False,
        }
    )

    result = await query_graph_workbench(
        rag,
        {
            "scope": {"label": "*", "max_depth": 1, "max_nodes": 10},
            "view_options": {"hide_low_weight_edges": True},
        },
    )

    assert [edge["id"] for edge in result["data"]["edges"]] == ["e-high"]


@pytest.mark.asyncio
async def test_meta_flags_filtering_on_truncated_base():
    # 回归 #2：基础图已截断且有过滤时，如实标记结果基于样本
    rag = _DummyRAG(
        graph_payload={
            "nodes": [_node("n1", "PERSON"), _node("n2", "ORGANIZATION")],
            "edges": [],
            "is_truncated": True,
        }
    )

    result = await query_graph_workbench(
        rag,
        {
            "scope": {"label": "*", "max_depth": 1, "max_nodes": 10},
            "node_filters": {"entity_types": ["PERSON"]},
        },
    )

    assert result["meta"]["execution_mode"] == "post_truncation_filter"
    assert result["meta"]["filtered_on_truncated_base"] is True


@pytest.mark.asyncio
async def test_meta_does_not_flag_when_not_truncated_or_no_filter():
    base_payload = {
        "nodes": [_node("n1", "PERSON"), _node("n2", "ORGANIZATION")],
        "edges": [],
    }

    # 未截断 + 有过滤 → 不标记
    rag_not_truncated = _DummyRAG(
        graph_payload={**base_payload, "is_truncated": False}
    )
    filtered = await query_graph_workbench(
        rag_not_truncated,
        {
            "scope": {"label": "*", "max_depth": 1, "max_nodes": 10},
            "node_filters": {"entity_types": ["PERSON"]},
        },
    )
    assert filtered["meta"]["filtered_on_truncated_base"] is False

    # 截断 + 无过滤 → 不标记
    rag_truncated = _DummyRAG(graph_payload={**base_payload, "is_truncated": True})
    unfiltered = await query_graph_workbench(
        rag_truncated,
        {"scope": {"label": "*", "max_depth": 1, "max_nodes": 10}},
    )
    assert unfiltered["meta"]["filtered_on_truncated_base"] is False


class _FullScanRAG(_DummyRAG):
    """提供 get_all_nodes/get_all_edges 以触发 filter-first；bounded 路径模拟 top-N 截断。"""

    def __init__(self, all_nodes, all_edges, bounded_payload, **kwargs):
        super().__init__(graph_payload=bounded_payload, **kwargs)
        self._all_nodes = all_nodes
        self._all_edges = all_edges
        self.get_all_nodes_calls = 0

    async def get_all_nodes(self):
        self.get_all_nodes_calls += 1
        return [dict(node) for node in self._all_nodes]

    async def get_all_edges(self):
        return [dict(edge) for edge in self._all_edges]


def _flat_node(node_id: str, entity_type: str) -> dict[str, Any]:
    return {"id": node_id, "entity_id": node_id, "entity_type": entity_type}


def _full_scan_fixture() -> tuple[list[dict], list[dict], dict[str, Any]]:
    all_nodes = [
        _flat_node("org1", "ORGANIZATION"),
        _flat_node("org2", "ORGANIZATION"),
        _flat_node("p1", "PERSON"),  # 低度数，top-N 会被丢弃
    ]
    all_edges = [
        {"source": "org1", "target": "org2", "relationship": "partner_of", "weight": 1.0},
        {"source": "org1", "target": "p1", "relationship": "employs", "weight": 1.0},
    ]
    # bounded 路径模拟"按度数 top-2"：只剩两个 ORG，PERSON 丢失且已截断
    bounded_payload = {
        "nodes": [_node("org1", "ORGANIZATION"), _node("org2", "ORGANIZATION")],
        "edges": [],
        "is_truncated": True,
    }
    return all_nodes, all_edges, bounded_payload


@pytest.mark.asyncio
async def test_filter_first_preserves_rare_type_that_top_n_would_drop():
    rag = _FullScanRAG(*_full_scan_fixture())

    result = await query_graph_workbench(
        rag,
        {
            "scope": {"label": "*", "max_depth": 2, "max_nodes": 2},
            "node_filters": {"entity_types": ["PERSON"]},
        },
    )

    assert rag.get_all_nodes_calls == 1
    assert result["meta"]["execution_mode"] == "filter_first_full_scan"
    assert {node["id"] for node in result["data"]["nodes"]} == {"p1"}
    # 在全图上过滤，未基于截断样本
    assert result["meta"]["filtered_on_truncated_base"] is False
    assert result["truncation"]["was_truncated_before_filtering"] is False


@pytest.mark.asyncio
async def test_filter_first_falls_back_when_scan_exceeds_limit(monkeypatch):
    rag = _FullScanRAG(*_full_scan_fixture())
    monkeypatch.setattr(graph_workbench, "FILTER_FIRST_SCAN_LIMIT", 1)

    result = await query_graph_workbench(
        rag,
        {
            "scope": {"label": "*", "max_depth": 2, "max_nodes": 10},
            "node_filters": {"entity_types": ["PERSON"]},
        },
    )

    # 回退到 bounded 路径：基础图已截断 + 有过滤 → 如实标记
    assert result["meta"]["execution_mode"] == "post_truncation_filter"
    assert result["meta"]["filtered_on_truncated_base"] is True


@pytest.mark.asyncio
async def test_no_filter_keeps_bounded_path_and_skips_full_scan():
    rag = _FullScanRAG(*_full_scan_fixture())

    result = await query_graph_workbench(
        rag,
        {"scope": {"label": "*", "max_depth": 2, "max_nodes": 10}},
    )

    assert rag.get_all_nodes_calls == 0
    assert result["meta"]["execution_mode"] == "post_truncation_filter"


@pytest.mark.asyncio
async def test_filter_first_only_triggers_for_global_label():
    rag = _FullScanRAG(*_full_scan_fixture())

    result = await query_graph_workbench(
        rag,
        {
            "scope": {"label": "org1", "max_depth": 2, "max_nodes": 10},
            "node_filters": {"entity_types": ["PERSON"]},
        },
    )

    # 指定起点标签不是 top-N 截断问题，走 bounded BFS，不全量扫描
    assert rag.get_all_nodes_calls == 0
    assert result["meta"]["execution_mode"] == "post_truncation_filter"


def test_revision_token_is_stable_for_equivalent_payloads():
    payload_a = {
        "entity_name": "Target",
        "graph_data": {
            "description": "desc",
            "entity_type": "ORG",
            "aliases": ["Legacy Target", "SourceA"],
        },
    }
    payload_b = {
        "graph_data": {
            "aliases": ["SourceA", "Legacy Target"],
            "entity_type": "ORG",
            "description": "desc",
        },
        "entity_name": "Target",
    }

    token_a = utils_graph.build_revision_token(payload_a)
    token_b = utils_graph.build_revision_token(payload_b)

    assert token_a == token_b


def test_revision_token_changes_when_aliases_change():
    base_payload = {
        "entity_name": "Target",
        "graph_data": {
            "description": "desc",
            "entity_type": "ORG",
            "aliases": ["Legacy Target", "SourceA"],
        },
    }
    changed_payload = {
        "entity_name": "Target",
        "graph_data": {
            "description": "desc",
            "entity_type": "ORG",
            "aliases": ["Legacy Target", "SourceA", "SourceB"],
        },
    }

    base_token = utils_graph.build_revision_token(base_payload)
    changed_token = utils_graph.build_revision_token(changed_payload)

    assert base_token != changed_token


def test_relation_revision_token_ignores_transport_source_and_target_fields():
    query_payload = {
        "src_entity": "A",
        "tgt_entity": "B",
        "graph_data": utils_graph.normalize_graph_edge_data(
            {
                "relationship": "works_with",
                "description": "works with",
                "keywords": "partnership",
                "weight": 0.9,
                "source_id": "chunk-1",
                "target_id": "chunk-2",
            }
        ),
    }
    delete_payload = utils_graph._build_relation_revision_payload(
        "A",
        "B",
        {
            "relationship": "works_with",
            "description": "works with",
            "keywords": "partnership",
            "weight": 0.9,
            "source_id": "chunk-1",
            "target_id": "chunk-2",
            "source": "A",
            "target": "B",
        },
    )

    assert utils_graph.build_revision_token(query_payload) == utils_graph.build_revision_token(
        delete_payload
    )


@pytest.mark.asyncio
async def test_query_result_includes_revision_tokens_and_aliases_from_graph_data():
    node_graph_data = {
        "entity_id": "Target",
        "description": "target-desc",
        "entity_type": "ORG",
        "aliases": ["Legacy Target", "SourceA"],
    }
    peer_graph_data = {
        "entity_id": "Peer",
        "description": "peer",
        "entity_type": "ORG",
    }
    edge_graph_data = {
        "description": "works with",
        "keywords": "partnership",
        "weight": 0.9,
    }
    rag = _DummyRAG(
        graph_payload={
            "nodes": [
                {
                    "id": "node-1",
                    "labels": ["Target"],
                    "graph_data": node_graph_data,
                },
                {
                    "id": "node-2",
                    "labels": ["Peer"],
                    "graph_data": peer_graph_data,
                },
            ],
            "edges": [
                {
                    "id": "edge-target-peer",
                    "source": "node-1",
                    "target": "node-2",
                    "type": "works_with",
                    "graph_data": edge_graph_data,
                }
            ],
            "is_truncated": False,
        }
    )

    result = await query_graph_workbench(
        rag,
        {"scope": {"label": "*", "max_depth": 1, "max_nodes": 10}},
    )

    nodes = result["data"]["nodes"]
    edges = result["data"]["edges"]
    target_node = next(node for node in nodes if node["id"] == "node-1")
    relation = edges[0]

    assert target_node["graph_data"]["aliases"] == ["Legacy Target", "SourceA"]
    assert "revision_token" in target_node
    assert "revision_token" in relation
    assert target_node["revision_token"] == utils_graph.build_revision_token(
        {"entity_name": "Target", "graph_data": node_graph_data}
    )
    assert relation["revision_token"] == utils_graph.build_revision_token(
        {
            "src_entity": "Peer",
            "tgt_entity": "Target",
            "graph_data": edge_graph_data,
        }
    )


@pytest.mark.asyncio
async def test_legacy_graph_payload_includes_node_and_edge_revision_tokens():
    rag = _DummyRAG(
        graph_payload={
            "nodes": [
                {
                    "id": "101",
                    "labels": ["EntityA"],
                    "graph_data": {
                        "entity_id": "EntityA",
                        "description": "A",
                        "entity_type": "ORG",
                    },
                },
                {
                    "id": "202",
                    "labels": ["EntityB"],
                    "graph_data": {
                        "entity_id": "EntityB",
                        "description": "B",
                        "entity_type": "ORG",
                    },
                },
            ],
            "edges": [
                {
                    "id": "edge-a-b",
                    "source": "101",
                    "target": "202",
                    "type": "related_to",
                    "graph_data": {"description": "A to B", "keywords": "rel", "weight": 1.0},
                }
            ],
            "is_truncated": False,
        }
    )

    payload = await get_legacy_graph_payload(
        rag=rag,
        label="EntityA",
        max_depth=1,
        max_nodes=10,
    )

    assert "revision_token" in payload["nodes"][0]
    assert "revision_token" in payload["edges"][0]
    assert payload["nodes"][0]["revision_token"] == utils_graph.build_revision_token(
        {
            "entity_name": "EntityA",
            "graph_data": {
                "entity_id": "EntityA",
                "description": "A",
                "entity_type": "ORG",
            },
        }
    )
    assert payload["edges"][0]["revision_token"] == utils_graph.build_revision_token(
        {
            "src_entity": "EntityA",
            "tgt_entity": "EntityB",
            "graph_data": {"description": "A to B", "keywords": "rel", "weight": 1.0},
        }
    )
