import importlib
import sys

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


pytestmark = pytest.mark.offline


class _DummyRAG:
    def __init__(self):
        self.last_query: str | None = None
        self.last_param = None

    async def aquery_llm(self, query, param=None):
        self.last_query = query
        self.last_param = param
        return {
            "status": "success",
            "message": "ok",
            "data": {"references": [{"reference_id": "1", "file_path": "docs/a.md"}]},
            "metadata": {"mode": param.mode if param else None},
            "llm_response": {
                "content": f"echo:{query}",
                "response_iterator": None,
                "is_streaming": bool(param.stream) if param else False,
            },
        }


def _build_query_client(monkeypatch):
    monkeypatch.setattr(sys, "argv", [sys.argv[0]])

    query_routes = importlib.import_module("lightrag.api.routers.query_routes")
    query_routes = importlib.reload(query_routes)
    monkeypatch.setattr(
        query_routes, "get_combined_auth_dependency", lambda *_: (lambda: None)
    )

    rag = _DummyRAG()
    app = FastAPI()
    app.include_router(
        query_routes.create_query_routes(
            rag,
            api_key=None,
            allow_prompt_overrides_via_api=True,
        )
    )
    return TestClient(app), rag


def test_query_raw_route_returns_full_aquery_llm_structure_and_forces_non_streaming(
    monkeypatch,
):
    client, rag = _build_query_client(monkeypatch)

    response = client.post(
        "/query/raw",
        json={
            "query": "hello raw",
            "mode": "mix",
            "stream": True,
            "include_references": True,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "success"
    assert body["message"] == "ok"
    assert body["data"]["references"][0]["reference_id"] == "1"
    assert body["llm_response"]["content"] == "echo:hello raw"
    assert body["llm_response"]["response_iterator"] is None
    assert body["llm_response"]["is_streaming"] is False
    assert rag.last_query == "hello raw"
    assert rag.last_param is not None
    assert rag.last_param.mode == "mix"
    assert rag.last_param.stream is False
