import asyncio
from types import SimpleNamespace

import pytest

from lightrag.lightrag import LightRAG


pytestmark = pytest.mark.offline


class _HangingChunkStorage:
    def __init__(self):
        self.probed = 0

    async def is_empty(self) -> bool:
        self.probed += 1
        await asyncio.sleep(1)
        return True


class _UnexpectedGraphStorage:
    async def get_all_nodes(self):
        raise AssertionError("chunk migration should skip before fetching nodes")

    async def get_all_edges(self):
        raise AssertionError("chunk migration should skip before fetching edges")


@pytest.mark.asyncio
async def test_chunk_tracking_migration_skips_when_probe_times_out(monkeypatch):
    monkeypatch.setattr("lightrag.lightrag._MIGRATION_PROBE_TIMEOUT_SECONDS", 0.01)

    entity_chunks = _HangingChunkStorage()
    relation_chunks = _HangingChunkStorage()
    fake_rag = SimpleNamespace(
        entity_chunks=entity_chunks,
        relation_chunks=relation_chunks,
        chunk_entity_relation_graph=_UnexpectedGraphStorage(),
    )

    await LightRAG._migrate_chunk_tracking_storage(fake_rag)

    assert entity_chunks.probed == 1
    assert relation_chunks.probed == 0
