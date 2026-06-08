import json
import sys
from importlib import import_module, reload
from pathlib import Path


def _load_query_request_schema():
    original_argv = list(sys.argv)
    sys.argv = [sys.argv[0]]
    try:
        query_routes = import_module("lightrag.api.routers.query_routes")
        query_routes = reload(query_routes)
        return query_routes.QueryRequest.model_json_schema()
    finally:
        sys.argv = original_argv


def test_dify_query_tool_openapi_is_valid_and_aligned_with_query_request():
    schema_path = (
        Path(__file__).resolve().parents[1]
        / "docs"
        / "integrations"
        / "dify-query-tool.openapi.json"
    )

    schema = json.loads(schema_path.read_text(encoding="utf-8"))

    assert schema["openapi"] == "3.0.3"
    assert schema["paths"].keys() == {"/query"}

    query_post = schema["paths"]["/query"]["post"]
    assert query_post["operationId"] == "queryLightRAG"

    request_schema = query_post["requestBody"]["content"]["application/json"]["schema"]
    assert request_schema["$ref"] == "#/components/schemas/QueryToolRequest"

    tool_request = schema["components"]["schemas"]["QueryToolRequest"]
    query_request_schema = _load_query_request_schema()

    assert tool_request["required"] == query_request_schema["required"] == ["query"]
    assert tool_request["properties"]["mode"]["default"] == "mix"
    assert set(tool_request["properties"]) == set(query_request_schema["properties"])
    assert "prompt_overrides" not in tool_request["properties"]

    security_scheme = schema["components"]["securitySchemes"]["ApiKeyAuth"]
    assert security_scheme == {
        "type": "apiKey",
        "in": "header",
        "name": "X-API-Key",
        "description": "使用 LightRAG 服务端的 API Key。若你的部署依赖 JWT 登录而不是固定 API Key，请调整此 Schema 或增加代理层。",
    }

    response_schema = schema["components"]["schemas"]["QueryToolResponse"]
    assert response_schema["required"] == ["response"]
