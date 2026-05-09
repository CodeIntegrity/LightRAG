import importlib
import asyncio
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from lightrag.base import DocProcessingStatus, DocStatus
from lightrag.kg.shared_storage import initialize_pipeline_status, initialize_share_data


pytestmark = pytest.mark.offline


class _DummyRAG:
    def __init__(self):
        self.last_custom_chunks_request: dict | None = None
        self.last_doc_ids_query: list[str] | None = None
        self.custom_chunk_rebuild_calls = 0
        self.last_rebuild_doc_ids: list[str] | None = None
        self.workspace = "test-doc-routes"
        self.doc_status = _DummyDocStatusStorage()
        self.text_chunks = _DummyTextChunkStorage()

    async def ainsert_custom_chunks(
        self,
        full_text: str,
        text_chunks: list[str],
        doc_id: str | None = None,
        file_path: str | None = None,
    ) -> None:
        self.last_custom_chunks_request = {
            "full_text": full_text,
            "text_chunks": list(text_chunks),
            "doc_id": doc_id,
            "file_path": file_path,
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

    async def arebuild_all_custom_chunks_graphs(
        self, doc_ids: list[str] | None = None
    ) -> None:
        self.custom_chunk_rebuild_calls += 1
        self.last_rebuild_doc_ids = doc_ids


class _DummyDocStatusStorage:
    async def get_by_id(self, doc_id: str) -> DocProcessingStatus | dict | None:
        if doc_id == "doc-custom-1":
            return DocProcessingStatus(
                content_summary="Custom chunk document",
                content_length=100,
                file_path="",
                status=DocStatus.PROCESSED,
                created_at="2026-03-31T12:00:00",
                updated_at="2026-03-31T12:01:00",
                chunks_count=2,
                chunks_list=["chunk-b", "chunk-a"],
                metadata={"source": "custom_chunks"},
            )
        if doc_id == "doc-custom-dict":
            return {
                "content_summary": "Custom chunk document",
                "content_length": 100,
                "file_path": "",
                "status": "processed",
                "created_at": "2026-03-31T12:00:00",
                "updated_at": "2026-03-31T12:01:00",
                "chunks_count": 2,
                "chunks_list": ["chunk-b", "chunk-a"],
                "metadata": {"source": "custom_chunks"},
            }
        if doc_id == "folder/doc-custom-2":
            return DocProcessingStatus(
                content_summary="Custom chunk document with slash id",
                content_length=100,
                file_path="folder/doc-custom-2.md",
                status=DocStatus.PROCESSED,
                created_at="2026-03-31T12:00:00",
                updated_at="2026-03-31T12:01:00",
                chunks_count=2,
                chunks_list=["chunk-b", "chunk-a"],
                metadata={"source": "custom_chunks"},
            )
        return None


class _DummyTextChunkStorage:
    async def get_by_ids(self, ids: list[str]) -> list[dict | None]:
        chunks_by_id = {
            "chunk-a": {
                "content": "Alpha chunk body",
                "tokens": 12,
                "chunk_order_index": 1,
            },
            "chunk-b": {
                "content": "Beta chunk body",
                "tokens": 9,
                "chunk_order_index": 0,
            },
        }
        return [chunks_by_id.get(chunk_id) for chunk_id in ids]


def _build_document_client(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(sys, "argv", [sys.argv[0]])
    initialize_share_data()
    asyncio.run(initialize_pipeline_status(workspace="test-doc-routes"))

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
            "file_path": "docs/custom/doc-custom-1.md",
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
        "file_path": "docs/custom/doc-custom-1.md",
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


def test_rebuild_custom_chunks_graph_route_schedules_background_task(
    tmp_path: Path, monkeypatch
):
    client, rag = _build_document_client(tmp_path, monkeypatch)

    response = client.post("/documents/rebuild_custom_chunks_graph")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "rebuild_started"
    assert rag.custom_chunk_rebuild_calls == 1
    assert rag.last_rebuild_doc_ids is None


def test_rebuild_custom_chunks_graph_route_accepts_selected_doc_ids(
    tmp_path: Path, monkeypatch
):
    client, rag = _build_document_client(tmp_path, monkeypatch)

    response = client.post(
        "/documents/rebuild_custom_chunks_graph",
        json={"doc_ids": ["doc-custom-1", " doc-custom-dict ", "doc-custom-1"]},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "rebuild_started"
    assert rag.custom_chunk_rebuild_calls == 1
    assert rag.last_rebuild_doc_ids == ["doc-custom-1", "doc-custom-dict"]


def test_document_chunks_route_returns_chunk_content_in_doc_order(
    tmp_path: Path, monkeypatch
):
    client, _ = _build_document_client(tmp_path, monkeypatch)

    response = client.get("/documents/doc-custom-1/chunks")

    assert response.status_code == 200
    body = response.json()
    assert body["doc_id"] == "doc-custom-1"
    assert body["chunk_count"] == 2
    assert body["chunks"] == [
        {
            "id": "chunk-b",
            "content": "Beta chunk body",
            "tokens": 9,
            "order": 0,
        },
        {
            "id": "chunk-a",
            "content": "Alpha chunk body",
            "tokens": 12,
            "order": 1,
        },
    ]


def test_document_chunks_route_accepts_dict_doc_status(
    tmp_path: Path, monkeypatch
):
    client, _ = _build_document_client(tmp_path, monkeypatch)

    response = client.get("/documents/doc-custom-dict/chunks")

    assert response.status_code == 200
    body = response.json()
    assert body["doc_id"] == "doc-custom-dict"
    assert body["chunk_count"] == 2
    assert [chunk["id"] for chunk in body["chunks"]] == ["chunk-b", "chunk-a"]


def test_document_chunks_route_supports_doc_ids_with_slashes(
    tmp_path: Path, monkeypatch
):
    client, _ = _build_document_client(tmp_path, monkeypatch)

    response = client.get("/documents/folder%2Fdoc-custom-2/chunks")

    assert response.status_code == 200
    body = response.json()
    assert body["doc_id"] == "folder/doc-custom-2"
    assert body["chunk_count"] == 2
    assert [chunk["id"] for chunk in body["chunks"]] == ["chunk-b", "chunk-a"]
