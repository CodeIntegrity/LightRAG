"""
Integration tests for API and WebUI path prefix support via root_path.

With the root_path approach, routes always stay at their natural paths
(/docs, /health, /query, /documents/...). The api_prefix is passed to
FastAPI's root_path parameter, which controls the servers URL in the
OpenAPI spec for correct reverse proxy operation.
"""

import os
import sys
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

import pytest


@pytest.fixture
def mock_args_api_prefix():
    """Create mock args with API prefix."""
    from lightrag.api.config import parse_args

    original_argv = sys.argv.copy()
    try:
        sys.argv = ["lightrag-server", "--api-prefix", "/test-api"]
        args = parse_args()
        yield args
    finally:
        sys.argv = original_argv


@pytest.fixture
def mock_args_no_prefix():
    """Create mock args without API prefix."""
    from lightrag.api.config import parse_args

    original_argv = sys.argv.copy()
    try:
        sys.argv = ["lightrag-server"]
        args = parse_args()
        yield args
    finally:
        sys.argv = original_argv


class TestRootPathConfiguration:
    """Test that root_path is set correctly on the FastAPI app."""

    def test_root_path_set_when_prefix_provided(self, mock_args_api_prefix):
        """Test app.root_path reflects api_prefix."""
        with patch("lightrag.api.lightrag_server.LightRAG") as mock_rag:
            mock_rag.return_value = MagicMock()
            from lightrag.api.lightrag_server import create_app

            app = create_app(mock_args_api_prefix)
            assert app.root_path == "/test-api"

    def test_root_path_none_when_no_prefix(self, mock_args_no_prefix):
        """Test app.root_path is not set when no prefix is configured."""
        with patch("lightrag.api.lightrag_server.LightRAG") as mock_rag:
            mock_rag.return_value = MagicMock()
            from lightrag.api.lightrag_server import create_app

            app = create_app(mock_args_no_prefix)
            # When no prefix, root_path is None (not passed to FastAPI)
            # FastAPI stores None as-is, which means no root_path injection
            assert not app.root_path


class TestRoutesAtNaturalPaths:
    """Test that routes stay at their natural paths regardless of root_path."""

    def test_routes_accessible_at_both_paths_with_prefix(self, mock_args_api_prefix):
        """With root_path, routes work at both prefixed and natural paths.

        FastAPI injects root_path into the ASGI scope, and Starlette strips
        it from the path before matching. So /test-api/docs and /docs both work.
        """
        with patch("lightrag.api.lightrag_server.LightRAG") as mock_rag:
            mock_rag.return_value = MagicMock()
            from lightrag.api.lightrag_server import create_app

            app = create_app(mock_args_api_prefix)
            client = TestClient(app)

            # Natural path works
            response = client.get("/docs")
            assert response.status_code == 200

            response = client.get("/openapi.json")
            assert response.status_code == 200

            # Prefixed path also works (FastAPI strips root_path from scope)
            response = client.get("/test-api/docs")
            assert response.status_code == 200

            response = client.get("/test-api/openapi.json")
            assert response.status_code == 200

    def test_document_routes_at_natural_path(self, mock_args_api_prefix):
        """Test document routes are at /documents/ (their router-level prefix)."""
        with patch("lightrag.api.lightrag_server.LightRAG") as mock_rag:
            mock_rag.return_value = MagicMock()
            from lightrag.api.lightrag_server import create_app

            app = create_app(mock_args_api_prefix)
            client = TestClient(app)

            response = client.post(
                "/documents/paginated",
                json={},
                headers={"Authorization": "Bearer test"},
            )
            assert response.status_code != 404

    def test_routes_accessible_at_root_no_prefix(self, mock_args_no_prefix):
        """Test routes are at root when no prefix is set (default)."""
        with patch("lightrag.api.lightrag_server.LightRAG") as mock_rag:
            mock_rag.return_value = MagicMock()
            from lightrag.api.lightrag_server import create_app

            app = create_app(mock_args_no_prefix)
            client = TestClient(app)

            # API docs accessible at root
            response = client.get("/docs")
            assert response.status_code == 200

            # openapi.json at root
            response = client.get("/openapi.json")
            assert response.status_code == 200

            # Prefixed paths return 404 when no root_path is configured
            response = client.get("/test-api/docs")
            assert response.status_code == 404


class TestOpenAPISpecIntegration:
    """Test that OpenAPI spec uses root_path for servers URL."""

    def test_openapi_spec_has_servers_url_with_prefix(self, mock_args_api_prefix):
        """Test OpenAPI spec servers URL includes the prefix via root_path."""
        with patch("lightrag.api.lightrag_server.LightRAG") as mock_rag:
            mock_rag.return_value = MagicMock()
            from lightrag.api.lightrag_server import create_app

            app = create_app(mock_args_api_prefix)
            client = TestClient(app)

            # OpenAPI JSON is served at the natural path
            response = client.get("/openapi.json")
            assert response.status_code == 200
            spec = response.json()

            # Servers URL should include the prefix
            servers = spec.get("servers", [])
            assert (
                len(servers) > 0
            ), "OpenAPI spec should have servers entry when root_path is set"
            assert (
                "/test-api" in servers[0].get("url", "")
            ), f"Expected servers URL to contain /test-api, got: {servers[0].get('url')}"

    def test_openapi_spec_no_servers_without_prefix(self, mock_args_no_prefix):
        """Test OpenAPI spec has no servers entry when no root_path."""
        with patch("lightrag.api.lightrag_server.LightRAG") as mock_rag:
            mock_rag.return_value = MagicMock()
            from lightrag.api.lightrag_server import create_app

            app = create_app(mock_args_no_prefix)
            client = TestClient(app)

            response = client.get("/openapi.json")
            assert response.status_code == 200
            spec = response.json()

            # No servers when root_path is None/empty
            assert "servers" not in spec or spec["servers"] is None

    def test_openapi_spec_paths_at_natural_paths(self, mock_args_api_prefix):
        """Test OpenAPI spec paths are at natural paths (not prefixed)."""
        with patch("lightrag.api.lightrag_server.LightRAG") as mock_rag:
            mock_rag.return_value = MagicMock()
            from lightrag.api.lightrag_server import create_app

            app = create_app(mock_args_api_prefix)
            client = TestClient(app)

            response = client.get("/openapi.json")
            assert response.status_code == 200
            spec = response.json()
            paths = spec.get("paths", {})

            # Paths should be at natural paths
            for path in paths:
                if path == "/":
                    continue
                assert not path.startswith(
                    "/test-api/"
                ), f"Path {path} should not be prefixed with /test-api/ in root_path mode"


class TestWebUIPrefixIntegration:
    """Test that WebUI is served at the correct path."""

    def test_webui_at_prefixed_path(self, mock_args_api_prefix):
        """Test WebUI assets are at the prefixed path.

        When root_path is set, the WebUI is served under {root_path}{webui_path}
        because FastAPI injects root_path into the ASGI scope.
        """
        with patch("lightrag.api.lightrag_server.LightRAG") as mock_rag:
            mock_rag.return_value = MagicMock()
            from lightrag.api.lightrag_server import create_app
            from lightrag.api.config import parse_args

            original_argv = sys.argv.copy()
            try:
                sys.argv = [
                    "lightrag-server",
                    "--api-prefix",
                    "/test-api",
                    "--webui-path",
                    "/test-webui",
                ]
                args = parse_args()
                app = create_app(args)
                client = TestClient(app)

                # With root_path="/test-api" and webui_path="/test-webui",
                # the WebUI is accessible at /test-api/test-webui/
                # (root_path + webui_path, since FastAPI injects root_path)
                response = client.get("/test-api/test-webui/")
                assert response.status_code in [200, 307]
            finally:
                sys.argv = original_argv

    def test_webui_without_api_prefix(self):
        """Test WebUI works with custom path when no API prefix is set."""
        with patch("lightrag.api.lightrag_server.LightRAG") as mock_rag:
            mock_rag.return_value = MagicMock()
            from lightrag.api.lightrag_server import create_app
            from lightrag.api.config import parse_args

            original_argv = sys.argv.copy()
            try:
                sys.argv = ["lightrag-server", "--webui-path", "/test-webui"]
                args = parse_args()
                app = create_app(args)
                client = TestClient(app)

                response = client.get("/test-webui/")
                assert response.status_code in [200, 307]
            finally:
                sys.argv = original_argv

    def test_webui_not_at_default_path_with_custom(self, mock_args_api_prefix):
        """Test /webui returns 404 when custom path is set."""
        with patch("lightrag.api.lightrag_server.LightRAG") as mock_rag:
            mock_rag.return_value = MagicMock()
            from lightrag.api.lightrag_server import create_app
            from lightrag.api.config import parse_args

            original_argv = sys.argv.copy()
            try:
                sys.argv = [
                    "lightrag-server",
                    "--api-prefix",
                    "/test-api",
                    "--webui-path",
                    "/test-webui",
                ]
                args = parse_args()
                app = create_app(args)
                client = TestClient(app)

                # /webui should not exist when custom path is set
                response = client.get("/webui/")
                assert response.status_code == 404
            finally:
                sys.argv = original_argv


class TestEnvironmentVariables:
    """Test that environment variables are read correctly."""

    def test_env_api_prefix(self):
        """Test LIGHTRAG_API_PREFIX environment variable."""
        from lightrag.api.config import get_env_value

        os.environ["LIGHTRAG_API_PREFIX"] = "unit-test-back/api"
        try:
            value = get_env_value("LIGHTRAG_API_PREFIX", "")
            assert value == "unit-test-back/api"
        finally:
            del os.environ["LIGHTRAG_API_PREFIX"]

    def test_env_webui_path(self):
        """Test LIGHTRAG_WEBUI_PATH environment variable."""
        from lightrag.api.config import get_env_value

        os.environ["LIGHTRAG_WEBUI_PATH"] = "unit-test-front/webui"
        try:
            value = get_env_value("LIGHTRAG_WEBUI_PATH", "/webui")
            assert value == "unit-test-front/webui"
        finally:
            del os.environ["LIGHTRAG_WEBUI_PATH"]
