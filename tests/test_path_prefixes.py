"""
Integration tests for API and WebUI path prefix support.

Tests that routes are actually accessible at the correct prefixed paths
and that unprefixed paths return 404 when a prefix is set.
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
        sys.argv = ['lightrag-server', '--api-prefix', '/test-api']
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
        sys.argv = ['lightrag-server']
        args = parse_args()
        yield args
    finally:
        sys.argv = original_argv


class TestAPIPrefixIntegration:
    """Test that API routes work at prefixed paths."""

    def test_routes_mounted_at_prefixed_paths(self, mock_args_api_prefix):
        """Test that routes are accessible at prefixed paths."""
        with patch('lightrag.api.lightrag_server.LightRAG') as mock_rag:
            mock_rag.return_value = MagicMock()
            from lightrag.api.lightrag_server import create_app
            app = create_app(mock_args_api_prefix)
            client = TestClient(app)

            # Test API docs accessible at prefixed path
            response = client.get('/test-api/docs')
            assert response.status_code == 200

            # Test openapi.json at prefixed path
            response = client.get('/test-api/openapi.json')
            assert response.status_code == 200

            # Test that unprefixed paths return 404
            response = client.get('/docs')
            assert response.status_code == 404

            response = client.get('/openapi.json')
            assert response.status_code == 404

    def test_document_routes_prefixed(self, mock_args_api_prefix):
        """Test document routes are at prefixed path (not duplicate)."""
        with patch('lightrag.api.lightrag_server.LightRAG') as mock_rag:
            mock_rag.return_value = MagicMock()
            from lightrag.api.lightrag_server import create_app
            app = create_app(mock_args_api_prefix)
            client = TestClient(app)

            # This should work (single /documents/, not /documents/documents/)
            response = client.post(
                '/test-api/documents/paginated',
                json={},
                headers={'Authorization': 'Bearer test'}
            )
            # Should not be 404 (not found) - may be 422 (validation) or other
            # but NOT 404 which would indicate wrong path
            assert response.status_code != 404


class TestNoPrefixIntegration:
    """Test that default behavior is preserved without prefixes."""

    def test_routes_at_root_no_prefix(self, mock_args_no_prefix):
        """Test that routes are accessible at root when no prefix."""
        with patch('lightrag.api.lightrag_server.LightRAG') as mock_rag:
            mock_rag.return_value = MagicMock()
            from lightrag.api.lightrag_server import create_app
            app = create_app(mock_args_no_prefix)
            client = TestClient(app)

            # Test API docs accessible at root
            response = client.get('/docs')
            assert response.status_code == 200

            # Test openapi.json at root
            response = client.get('/openapi.json')
            assert response.status_code == 200

            # Test that prefixed paths return 404
            response = client.get('/test-api/docs')
            assert response.status_code == 404


class TestWebUIPrefixIntegration:
    """Test that WebUI is served at the correct prefixed path."""

    def test_webui_at_prefixed_path(self, mock_args_api_prefix):
        """Test WebUI assets are at the prefixed path."""
        with patch('lightrag.api.lightrag_server.LightRAG') as mock_rag:
            mock_rag.return_value = MagicMock()
            from lightrag.api.lightrag_server import create_app
            from lightrag.api.config import parse_args

            # Set webui path in args
            original_argv = sys.argv.copy()
            try:
                sys.argv = ['lightrag-server', '--api-prefix', '/test-api', '--webui-path', '/test-webui']
                args = parse_args()
                app = create_app(args)
                client = TestClient(app)

                # Test that prefixed WebUI path works
                response = client.get('/test-webui/')
                # Should be 200 (if assets exist) or 307 redirect (if not)
                assert response.status_code in [200, 307]
            finally:
                sys.argv = original_argv

    def test_webui_not_at_unprefixed_path_with_prefix(self, mock_args_api_prefix):
        """Test /webui returns 404 when custom path is set."""
        with patch('lightrag.api.lightrag_server.LightRAG') as mock_rag:
            mock_rag.return_value = MagicMock()
            from lightrag.api.lightrag_server import create_app
            from lightrag.api.config import parse_args

            original_argv = sys.argv.copy()
            try:
                sys.argv = ['lightrag-server', '--api-prefix', '/test-api', '--webui-path', '/test-webui']
                args = parse_args()
                app = create_app(args)
                client = TestClient(app)

                # /webui should not exist when custom path is set
                response = client.get('/webui/')
                assert response.status_code == 404
            finally:
                sys.argv = original_argv


class TestEnvironmentVariables:
    """Test that environment variables are read correctly."""

    def test_env_api_prefix(self):
        """Test LIGHTRAG_API_PREFIX environment variable."""
        from lightrag.api.config import get_env_value

        os.environ['LIGHTRAG_API_PREFIX'] = 'unit-test-back/api'
        try:
            value = get_env_value("LIGHTRAG_API_PREFIX", "")
            assert value == 'unit-test-back/api'
        finally:
            del os.environ['LIGHTRAG_API_PREFIX']

    def test_env_webui_path(self):
        """Test LIGHTRAG_WEBUI_PATH environment variable."""
        from lightrag.api.config import get_env_value

        os.environ['LIGHTRAG_WEBUI_PATH'] = 'unit-test-front/webui'
        try:
            value = get_env_value("LIGHTRAG_WEBUI_PATH", "/webui")
            assert value == 'unit-test-front/webui'
        finally:
            del os.environ['LIGHTRAG_WEBUI_PATH']
