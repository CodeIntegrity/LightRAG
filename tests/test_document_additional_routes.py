import importlib
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from lightrag.base import DocProcessingStatus, DocStatus


pytestmark = pytest.mark.offline


class _DummyRAG:
    def __init__(self):
        self.last_custom_chunks_request: dict | None = None
        self.last_doc_ids_query: list[str] | None = None

    async def ainsert_custom_chunks(
        self, full_text: str, text_chunks: list[str], doc_id: str | None = None
    ) -> None:
        self.last_custom_chunks_request = {
            "full_text": full_text,
            "text_chunks": list(text_chunks),
            "doc_id": doc_id,
        }

    async def aget_docs_by_ids(
        self, ids: str | list[str]
    ) -> dict[str, DocProcessingStatus]:
        if isinstance(ids, str):
            normalized = [ids]
        else:
            normalized = list(ids)
        self.last_doc_ids_query = normalized
        return {
            "doc-1": DocProcessingStatus(
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
            "doc-2": DocProcessingStatus(
                content_summary="Second document",
                content_length=50,
                file_path="docs/two.md",
                status=DocStatus.FAILED,
                created_at="2026-03-31T12:02:00",
                updated_at="2026-03-31T12:03:00",
                track_id="track-2",
                chunks_count=1,
                error_msg="boom",
                metadata={"lang": "zh"},
            ),
        }


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
    return TestClient(app), rag


def test_import_custom_chunks_route_calls_core_method(tmp_path: Path, monkeypatch):
    client, rag = _build_document_client(tmp_path, monkeypatch)

    response = client.post(
        "/documents/import/custom-chunks",
        json={
            "full_text": "Alpha Beta",
            "text_chunks": ["Alpha", "Beta"],
            "doc_id": "doc-custom-1",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "success"
    assert body["doc_id"] == "doc-custom-1"
    assert body["requested_chunk_count"] == 2
    assert rag.last_custom_chunks_request == {
        "full_text": "Alpha Beta",
        "text_chunks": ["Alpha", "Beta"],
        "doc_id": "doc-custom-1",
    }


def test_documents_by_ids_route_returns_serialized_docs_in_request_order(
    tmp_path: Path, monkeypatch
):
    client, rag = _build_document_client(tmp_path, monkeypatch)

    response = client.post(
        "/documents/by-ids",
        json={"doc_ids": ["doc-2", "doc-missing", "doc-1"]},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["requested_count"] == 3
    assert body["found_count"] == 2
    assert [item["id"] for item in body["documents"]] == ["doc-2", "doc-1"]
    assert body["documents"][0]["status"] == "failed"
    assert body["documents"][1]["status"] == "processed"
    assert rag.last_doc_ids_query == ["doc-2", "doc-missing", "doc-1"]
