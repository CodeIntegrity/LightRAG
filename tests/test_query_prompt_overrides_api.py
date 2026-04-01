import importlib
import json
import sys

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

pytestmark = pytest.mark.offline


class _DummyRAG:
    def __init__(self, *args, **kwargs):
        self.ollama_server_infos = kwargs.get("ollama_server_infos")

    async def initialize_storages(self):
        return None

    async def check_and_migrate_data(self):
        return None

    async def finalize_storages(self):
        return None

    async def aquery_llm(self, query, param=None):
        return {
            "llm_response": {"content": f"echo:{query}", "is_streaming": False},
            "data": {"references": []},
        }

    async def aquery_data(self, query, param=None):
        return {"status": "success", "message": "ok", "data": {}, "metadata": {}}


class _DummyOllamaAPI:
    def __init__(self, rag, top_k=60, api_key=None):
        self.router = APIRouter()


def _build_test_client(
    monkeypatch,
    *,
    rag_cls=_DummyRAG,
    allow_prompt_overrides_via_api: bool,
):
    monkeypatch.setattr(sys, "argv", [sys.argv[0]])
    from lightrag.api.routers import query_routes as query_routes_module

    query_routes_module = importlib.reload(query_routes_module)
    query_routes_module.router.routes.clear()
    monkeypatch.setattr(
        query_routes_module, "get_combined_auth_dependency", lambda *_: (lambda: None)
    )

    app = FastAPI()
    app.include_router(
        query_routes_module.create_query_routes(
            rag_cls(),
            api_key=None,
            allow_prompt_overrides_via_api=allow_prompt_overrides_via_api,
        )
    )

    @app.get("/health")
    async def _health():
        return {
            "configuration": {
                "allow_prompt_overrides_via_api": allow_prompt_overrides_via_api
            }
        }

    return TestClient(app)


@pytest.fixture
def test_client(monkeypatch):
    return _build_test_client(
        monkeypatch,
        allow_prompt_overrides_via_api=False,
    )


@pytest.fixture
def test_client_capability_enabled_with_value_error(monkeypatch):
    class _DummyRAGValueError(_DummyRAG):
        async def aquery_llm(self, query, param=None):
            raise ValueError("Invalid prompt_overrides payload")

    return _build_test_client(
        monkeypatch,
        rag_cls=_DummyRAGValueError,
        allow_prompt_overrides_via_api=True,
    )


@pytest.fixture
def test_client_capability_enabled(monkeypatch):
    return _build_test_client(
        monkeypatch,
        allow_prompt_overrides_via_api=True,
    )


def test_query_request_converts_prompt_overrides_to_query_param():
    original_argv = list(sys.argv)
    sys.argv = [sys.argv[0]]
    from lightrag.api.routers.query_routes import QueryRequest
    sys.argv = original_argv

    request = QueryRequest(
        query="hello world",
        mode="mix",
        prompt_overrides={"query": {"rag_response": "{context_data}"}},
    )
    param = request.to_query_params(False)
    assert param.prompt_overrides["query"]["rag_response"] == "{context_data}"


def test_query_request_prompt_overrides_schema_is_structured():
    original_argv = list(sys.argv)
    sys.argv = [sys.argv[0]]
    from lightrag.api.routers.query_routes import QueryRequest
    sys.argv = original_argv

    schema = QueryRequest.model_json_schema()
    prompt_schema = schema["properties"]["prompt_overrides"]
    assert prompt_schema["anyOf"][0]["$ref"].endswith("QueryPromptOverridesPayload")


def test_query_endpoint_rejects_prompt_overrides_when_capability_disabled(test_client):
    response = test_client.post(
        "/query",
        json={
            "query": "hello world",
            "mode": "mix",
            "prompt_overrides": {"query": {"rag_response": "{context_data}"}},
        },
    )
    assert response.status_code == 403


def test_query_endpoint_rejects_empty_prompt_overrides_when_capability_disabled(
    test_client,
):
    response = test_client.post(
        "/query",
        json={"query": "hello world", "mode": "mix", "prompt_overrides": {}},
    )
    assert response.status_code == 403


def test_query_stream_endpoint_rejects_empty_prompt_overrides_when_capability_disabled(
    test_client,
):
    response = test_client.post(
        "/query/stream",
        json={"query": "hello world", "mode": "mix", "prompt_overrides": {}},
    )
    assert response.status_code == 403


def test_query_stream_endpoint_accepts_short_cjk_query(test_client):
    response = test_client.post(
        "/query/stream",
        json={"query": "你好", "mode": "mix"},
    )
    assert response.status_code == 200
    payload = json.loads(response.text)
    assert payload["response"] == "echo:你好"


def test_query_stream_endpoint_rejects_whitespace_only_query(test_client):
    response = test_client.post(
        "/query/stream",
        json={"query": "   ", "mode": "mix"},
    )
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert any(item["loc"][-1] == "query" for item in detail)


def test_query_data_endpoint_rejects_empty_prompt_overrides_when_capability_disabled(
    test_client,
):
    response = test_client.post(
        "/query/data",
        json={"query": "hello world", "mode": "mix", "prompt_overrides": {}},
    )
    assert response.status_code == 403


def test_health_exposes_prompt_override_capability(test_client):
    response = test_client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["configuration"]["allow_prompt_overrides_via_api"] is False


def test_query_endpoint_returns_400_for_invalid_prompt_overrides_when_capability_enabled(
    test_client_capability_enabled,
):
    response = test_client_capability_enabled.post(
        "/query",
        json={
            "query": "hello world",
            "mode": "mix",
            "prompt_overrides": {"bad-family": {"x": 1}},
        },
    )
    assert response.status_code == 422


def test_query_endpoint_keeps_backend_value_error_as_500_when_prompt_overrides_are_valid(
    test_client_capability_enabled_with_value_error,
):
    response = test_client_capability_enabled_with_value_error.post(
        "/query",
        json={
            "query": "hello world",
            "mode": "mix",
            "prompt_overrides": {"query": {"rag_response": "{context_data}"}},
        },
    )
    assert response.status_code == 500


def test_query_endpoint_rejects_prompt_overrides_in_bypass_mode(
    test_client_capability_enabled,
):
    response = test_client_capability_enabled.post(
        "/query",
        json={
            "query": "hello world",
            "mode": "bypass",
            "prompt_overrides": {"query": {"rag_response": "{context_data}"}},
        },
    )
    assert response.status_code == 400
