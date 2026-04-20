import importlib
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from lightrag.base import DocProcessingStatus, DocStatus


pytestmark = pytest.mark.offline


class _DummyDocStatus:
    async def get_docs_paginated(
        self,
        *,
        status_filter=None,
        page: int,
        page_size: int,
        sort_field: str,
        sort_direction: str,
    ):
        assert status_filter is None
        assert page == 1
        assert page_size == 20
        assert sort_field == "updated_at"
        assert sort_direction == "desc"
        return [
            (
                "doc-1",
                DocProcessingStatus(
                    content_summary="First document",
                    content_length=100,
                    file_path="docs/one.md",
                    status=DocStatus.PROCESSED,
                    created_at="2026-03-31T12:00:00",
                    updated_at="2026-03-31T12:01:00",
                    track_id="track-1",
                    chunks_count=2,
                    metadata={"lang": "en"},
                ),
            )
        ], 1

    async def get_all_status_counts(self):
        return {"all": 1, "processed": 1}


class _DummyRAG:
    def __init__(self):
        self.workspace = "demo"
        self.doc_status = _DummyDocStatus()


def _build_document_client(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(sys, "argv", [sys.argv[0]])

    document_routes = importlib.import_module("lightrag.api.routers.document_routes")
    document_routes = importlib.reload(document_routes)
    monkeypatch.setattr(
        document_routes, "get_combined_auth_dependency", lambda *_: (lambda: None)
    )

    rag = _DummyRAG()
    doc_manager = document_routes.DocumentManager(
        str(tmp_path / "inputs"), workspace="demo"
    )

    app = FastAPI()
    app.include_router(document_routes.create_document_routes(rag, doc_manager))
    return TestClient(app)


def test_documents_paginated_route_returns_page_data(tmp_path: Path, monkeypatch):
    client = _build_document_client(tmp_path, monkeypatch)

    response = client.post(
        "/documents/paginated",
        json={
            "status_filter": None,
            "page": 1,
            "page_size": 20,
            "sort_field": "updated_at",
            "sort_direction": "desc",
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "documents": [
            {
                "id": "doc-1",
                "content_summary": "First document",
                "content_length": 100,
                "status": "processed",
                "created_at": "2026-03-31T12:00:00",
                "updated_at": "2026-03-31T12:01:00",
                "track_id": "track-1",
                "chunks_count": 2,
                "error_msg": None,
                "metadata": {"lang": "en"},
                "file_path": "docs/one.md",
            }
        ],
        "pagination": {
            "page": 1,
            "page_size": 20,
            "total_count": 1,
            "total_pages": 1,
            "has_next": False,
            "has_prev": False,
        },
        "status_counts": {"all": 1, "processed": 1},
    }


def test_legacy_documents_route_is_removed(tmp_path: Path, monkeypatch):
    client = _build_document_client(tmp_path, monkeypatch)

    response = client.get("/documents")

    assert response.status_code == 405
