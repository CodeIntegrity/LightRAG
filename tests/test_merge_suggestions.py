from __future__ import annotations

from typing import Any

import pytest

from lightrag import utils_graph

pytestmark = pytest.mark.offline


class _DummyRAG:
    def __init__(
        self,
        graph_payload: dict[str, Any],
        llm_response: str | None = None,
        llm_error: Exception | None = None,
    ) -> None:
        self.graph_payload = graph_payload
        self.llm_response = llm_response
        self.llm_error = llm_error
        self.last_graph_call: dict[str, Any] | None = None
        self.last_llm_prompt: str | None = None
        self.last_llm_system_prompt: str | None = None
        self.last_llm_kwargs: dict[str, Any] | None = None

    async def get_knowledge_graph(
        self, node_label: str, max_depth: int, max_nodes: int
    ) -> dict[str, Any]:
        self.last_graph_call = {
            "node_label": node_label,
            "max_depth": max_depth,
            "max_nodes": max_nodes,
        }
        return self.graph_payload

    async def llm_model_func(
        self, prompt: str, system_prompt: str | None = None, **kwargs: Any
    ) -> str:
        self.last_llm_prompt = prompt
        self.last_llm_system_prompt = system_prompt
        self.last_llm_kwargs = dict(kwargs)
        if self.llm_error is not None:
            raise self.llm_error
        return self.llm_response or '{"scores":[]}'


def _node(
    entity_id: str,
    *,
    description: str = "",
    entity_type: str = "organization",
    aliases: list[str] | None = None,
    source_ids: list[str] | None = None,
    file_paths: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "id": entity_id,
        "labels": [entity_type],
        "properties": {
            "entity_id": entity_id,
            "description": description,
            "entity_type": entity_type,
            "aliases": aliases or [],
            "source_id": source_ids or [],
            "file_path": file_paths or [],
        },
    }


def _edge(
    edge_id: str,
    source: str,
    target: str,
    *,
    keywords: str = "",
    source_ids: list[str] | None = None,
    file_paths: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "id": edge_id,
        "source": source,
        "target": target,
        "type": "related_to",
        "properties": {
            "keywords": keywords,
            "source_id": source_ids or [],
            "file_path": file_paths or [],
            "description": keywords,
        },
    }


def _graph_payload_for_duplicates() -> dict[str, Any]:
    return {
        "nodes": [
            _node(
                "Tesla",
                description="Electric vehicle and energy company.",
                aliases=["Tesla, Inc."],
                source_ids=["doc-shared", "doc-tesla"],
                file_paths=["/docs/tesla.md"],
            ),
            _node(
                "Tesla Inc.",
                description="Electric vehicle and energy company.",
                source_ids=["doc-shared"],
                file_paths=["/docs/tesla.md"],
            ),
            _node(
                "Tesla Motors",
                description="Electric vehicle maker founded by the same team.",
                source_ids=["doc-shared", "doc-motors"],
                file_paths=["/docs/tesla.md"],
            ),
            _node(
                "OpenAI",
                description="AI research and deployment company.",
                aliases=["Open AI"],
                source_ids=["doc-openai"],
                file_paths=["/docs/openai.md"],
            ),
            _node(
                "Open AI",
                description="AI research and deployment company.",
                source_ids=["doc-openai"],
                file_paths=["/docs/openai.md"],
            ),
            _node(
                "Elon Musk",
                description="Entrepreneur.",
                entity_type="person",
                source_ids=["doc-shared"],
                file_paths=["/docs/people.md"],
            ),
        ],
        "edges": [
            _edge(
                "e1",
                "Tesla",
                "Elon Musk",
                keywords="founder leadership",
                source_ids=["doc-shared"],
                file_paths=["/docs/tesla.md"],
            ),
            _edge(
                "e2",
                "Tesla Inc.",
                "Elon Musk",
                keywords="founder leadership",
                source_ids=["doc-shared"],
                file_paths=["/docs/tesla.md"],
            ),
            _edge(
                "e3",
                "Tesla Motors",
                "Elon Musk",
                keywords="founder leadership",
                source_ids=["doc-shared"],
                file_paths=["/docs/tesla.md"],
            ),
        ],
        "is_truncated": False,
    }


@pytest.mark.asyncio
async def test_merge_suggestions_returns_heuristic_candidates_without_llm():
    rag = _DummyRAG(_graph_payload_for_duplicates())

    result = await utils_graph.aget_merge_suggestions(
        rag,
        {
            "scope": {"label": "Tesla", "max_depth": 1, "max_nodes": 64},
            "limit": 5,
            "min_score": 0.6,
            "use_llm": False,
        },
    )

    assert rag.last_graph_call == {
        "node_label": "Tesla",
        "max_depth": 1,
        "max_nodes": 64,
    }
    assert result["meta"]["strategy"] == "heuristic_v1"
    assert result["meta"]["llm_requested"] is False
    assert result["meta"]["llm_used"] is False
    assert result["candidates"]
    tesla_candidate = next(
        candidate for candidate in result["candidates"] if candidate["target_entity"] == "Tesla"
    )
    assert set(tesla_candidate["source_entities"]) == {"Tesla Inc.", "Tesla Motors"}
    reason_codes = {reason["code"] for reason in tesla_candidate["reasons"]}
    assert "name_similarity" in reason_codes
    assert "shared_neighbors" in reason_codes


@pytest.mark.asyncio
async def test_merge_suggestions_use_llm_can_rerank_heuristic_candidates():
    rag = _DummyRAG(
        _graph_payload_for_duplicates(),
        llm_response="""
        {
          "scores": [
            {"candidate_id": "OpenAI<-Open AI", "score": 0.98},
            {"candidate_id": "Tesla<-Tesla Inc.|Tesla Motors", "score": 0.10}
          ]
        }
        """,
    )

    result = await utils_graph.aget_merge_suggestions(
        rag,
        {
            "scope": {"label": "*", "max_depth": 1, "max_nodes": 64},
            "limit": 5,
            "min_score": 0.6,
            "use_llm": True,
        },
    )

    assert result["meta"]["llm_requested"] is True
    assert result["meta"]["llm_used"] is True
    assert result["meta"]["strategy"] == "heuristic_llm_rerank_v1"
    assert result["candidates"][0]["target_entity"] == "OpenAI"
    assert rag.last_llm_prompt is not None
    assert "OpenAI<-Open AI" in rag.last_llm_prompt


@pytest.mark.asyncio
async def test_merge_suggestions_llm_failure_falls_back_to_heuristic_results():
    rag = _DummyRAG(
        _graph_payload_for_duplicates(),
        llm_error=TimeoutError("llm timed out"),
    )

    result = await utils_graph.aget_merge_suggestions(
        rag,
        {
            "scope": {"label": "*", "max_depth": 1, "max_nodes": 64},
            "limit": 5,
            "min_score": 0.6,
            "use_llm": True,
        },
    )

    assert result["meta"]["llm_requested"] is True
    assert result["meta"]["llm_used"] is False
    assert result["meta"]["strategy"] == "heuristic_v1_fallback"
    assert "timed out" in result["meta"]["llm_fallback_reason"]
    assert any(candidate["target_entity"] == "Tesla" for candidate in result["candidates"])
