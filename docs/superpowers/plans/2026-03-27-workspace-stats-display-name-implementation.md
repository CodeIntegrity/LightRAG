# Workspace Chunk Stats And Display Name Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real workspace `chunk_count` support from document status metadata and make the WebUI show workspace `display_name` instead of only the raw workspace key.

**Architecture:** Keep the backend change intentionally narrow by deriving `chunk_count` from `doc_status.get_docs_by_status()` rather than inventing new count APIs for every graph/vector backend. On the frontend, cache `workspace -> display_name` metadata in shared settings state and let the workspace switcher prefer that label while preserving `currentWorkspace` as the authoritative request key.

**Tech Stack:** Python, FastAPI, pytest via `./scripts/test.sh`, Bun, React 19, Zustand, Vitest, Vite

---

## File Structure

- Modify: `tests/test_prompt_config_routes.py`
  - Add a real `chunk_count` stats regression path using the existing lightweight `create_app()` fixture.
- Modify: `lightrag/api/lightrag_server.py`
  - Derive `chunk_count` from document status records and update `capabilities.chunk_count`.
- Modify: `lightrag_webui/src/stores/settings.ts`
  - Add `workspaceDisplayNames` state and a merge setter.
- Modify: `lightrag_webui/src/components/workspace/WorkspaceManagerDialog.tsx`
  - Persist workspace `display_name` mapping after `listWorkspaces()` succeeds.
- Modify: `lightrag_webui/src/components/workspace/WorkspaceSwitcher.tsx`
  - Prefer cached `display_name` over the raw workspace key.
- Modify: `lightrag_webui/src/components/workspace/WorkspaceSwitcher.test.tsx`
  - Verify display-name preference and fallback behavior.

## Task 1: Backend Workspace `chunk_count`

**Files:**
- Modify: `tests/test_prompt_config_routes.py`
- Modify: `lightrag/api/lightrag_server.py`

- [ ] **Step 1: Write the failing backend stats test**

```python
from types import SimpleNamespace

from lightrag.base import DocStatus


class _DummyDocStatus:
    def __init__(self, workspace: str):
        self.workspace = workspace

    async def get_all_status_counts(self) -> dict[str, int]:
        if self.workspace == "ws1":
            return {"all": 2}
        return {"all": 0}

    async def get_docs_by_status(self, status: DocStatus) -> dict[str, object]:
        if self.workspace != "ws1":
            return {}
        if status == DocStatus.PROCESSED:
            return {
                "doc-1": SimpleNamespace(chunks_count=3),
                "doc-2": SimpleNamespace(chunks_count=2),
            }
        return {}


class _DummyRAG:
    def __init__(self, *args, **kwargs):
        self.ollama_server_infos = kwargs.get("ollama_server_infos")
        self.working_dir = kwargs["working_dir"]
        self.workspace = kwargs.get("workspace", "")
        self.doc_status = _DummyDocStatus(self.workspace or "default")
        self.prompt_version_store = PromptVersionStore(
            kwargs["working_dir"], workspace=kwargs.get("workspace", "")
        )

    async def initialize_storages(self):
        return None

    async def check_and_migrate_data(self):
        return None

    async def finalize_storages(self):
        return None


def test_workspace_stats_expose_chunk_count_capability(test_client):
    create_response = test_client.post(
        "/workspaces",
        json={
            "workspace": "ws1",
            "display_name": "Workspace 1",
            "description": "stats test",
            "visibility": "public",
        },
        headers={"Authorization": f"Bearer {_build_token('alice', 'user')}"},
    )
    assert create_response.status_code == 201

    response = test_client.get("/workspaces/ws1/stats")

    assert response.status_code == 200
    body = response.json()
    assert body["document_count"] == 2
    assert body["chunk_count"] == 5
    assert body["capabilities"]["document_count"] == "available"
    assert body["capabilities"]["chunk_count"] == "available"
    assert body["entity_count"] is None
    assert body["relation_count"] is None
    assert body["storage_size_bytes"] is None
```

- [ ] **Step 2: Run the backend stats test to verify it fails**

Run: `./scripts/test.sh tests/test_prompt_config_routes.py -q`
Expected: FAIL because `chunk_count` is still `null` and `capabilities.chunk_count` is still `unsupported_by_backend`

- [ ] **Step 3: Implement minimal `chunk_count` aggregation in the stats endpoint**

```python
from lightrag.base import DocStatus


async def get_workspace_stats(workspace: str) -> dict[str, object]:
    prompt_store = PromptVersionStore(args.working_dir, workspace=workspace)
    prompt_version_count = 0
    for group_type in ("indexing", "retrieval"):
        try:
            prompt_version_count += len(
                prompt_store.list_versions(group_type).get("versions", [])
            )
        except Exception:
            pass

    document_count: int | None = None
    document_capability = "unsupported_by_backend"
    chunk_count: int | None = None
    chunk_capability = "unsupported_by_backend"

    try:
        bundle = await runtime_manager.acquire_runtime(workspace)
    except WorkspaceStateError:
        bundle = None

    if bundle is not None:
        try:
            status_counts = await bundle.rag.doc_status.get_all_status_counts()
            document_count = int(status_counts.get("all", 0))
            document_capability = "available"
        except Exception:
            document_count = None
            document_capability = "unsupported_by_backend"

        try:
            total_chunks = 0
            for status in DocStatus:
                docs = await bundle.rag.doc_status.get_docs_by_status(status)
                total_chunks += sum(
                    int(getattr(doc, "chunks_count", 0) or 0)
                    for doc in docs.values()
                )
            chunk_count = total_chunks
            chunk_capability = "available"
        except Exception:
            chunk_count = None
            chunk_capability = "unsupported_by_backend"
        finally:
            await runtime_manager.release_runtime(workspace)

    return {
        "document_count": document_count,
        "entity_count": None,
        "relation_count": None,
        "chunk_count": chunk_count,
        "storage_size_bytes": None,
        "prompt_version_count": prompt_version_count,
        "capabilities": {
            "document_count": document_capability,
            "entity_count": "unsupported_by_backend",
            "relation_count": "unsupported_by_backend",
            "chunk_count": chunk_capability,
            "storage_size_bytes": "unsupported_by_backend",
            "prompt_version_count": "available",
        },
    }
```

- [ ] **Step 4: Run the backend stats test to verify it passes**

Run: `./scripts/test.sh tests/test_prompt_config_routes.py -q`
Expected: PASS

- [ ] **Step 5: Commit the backend stats support**

```bash
git add tests/test_prompt_config_routes.py lightrag/api/lightrag_server.py
git commit -m "feat: expose workspace chunk stats"
```

## Task 2: Frontend Workspace `display_name` Preference

**Files:**
- Modify: `lightrag_webui/src/stores/settings.ts`
- Modify: `lightrag_webui/src/components/workspace/WorkspaceManagerDialog.tsx`
- Modify: `lightrag_webui/src/components/workspace/WorkspaceSwitcher.tsx`
- Modify: `lightrag_webui/src/components/workspace/WorkspaceSwitcher.test.tsx`

- [ ] **Step 1: Write the failing switcher tests**

```tsx
test('renders cached display name for the current workspace', async () => {
  const settings = await import('@/stores/settings')
  const originalCurrentSelector = settings.useSettingsStore.use.currentWorkspace
  const originalDisplayNameSelector = (settings.useSettingsStore.use as any).workspaceDisplayNames

  ;(settings.useSettingsStore.use as any).currentWorkspace = () => 'books'
  ;(settings.useSettingsStore.use as any).workspaceDisplayNames = () => ({
    books: 'Books Library',
  })

  const module = await import('./WorkspaceSwitcher')
  const html = renderToString(<module.default />)

  expect(html).toContain('Books Library')

  ;(settings.useSettingsStore.use as any).currentWorkspace = originalCurrentSelector
  ;(settings.useSettingsStore.use as any).workspaceDisplayNames = originalDisplayNameSelector
})

test('falls back to workspace key when no cached display name exists', async () => {
  const settings = await import('@/stores/settings')
  const originalCurrentSelector = settings.useSettingsStore.use.currentWorkspace
  const originalDisplayNameSelector = (settings.useSettingsStore.use as any).workspaceDisplayNames

  ;(settings.useSettingsStore.use as any).currentWorkspace = () => 'books'
  ;(settings.useSettingsStore.use as any).workspaceDisplayNames = () => ({})

  const module = await import('./WorkspaceSwitcher')
  const html = renderToString(<module.default />)

  expect(html).toContain('books')

  ;(settings.useSettingsStore.use as any).currentWorkspace = originalCurrentSelector
  ;(settings.useSettingsStore.use as any).workspaceDisplayNames = originalDisplayNameSelector
})
```

- [ ] **Step 2: Run the switcher tests to verify they fail**

Run: `cd lightrag_webui && bun test src/components/workspace/WorkspaceSwitcher.test.tsx`
Expected: FAIL because `workspaceDisplayNames` does not exist yet and the switcher still always renders `currentWorkspace`

- [ ] **Step 3: Implement the display-name cache and switcher label preference**

```ts
// lightrag_webui/src/stores/settings.ts
interface SettingsState {
  currentWorkspace: string
  setCurrentWorkspace: (workspace: string) => void
  workspaceDisplayNames: Record<string, string>
  setWorkspaceDisplayNames: (displayNames: Record<string, string>) => void
}

// add to the persisted initial state object
workspaceDisplayNames: {},

// add to SettingsState
workspaceDisplayNames: Record<string, string>
setWorkspaceDisplayNames: (displayNames: Record<string, string>) => void

// add to store actions
setWorkspaceDisplayNames: (displayNames: Record<string, string>) =>
  set((state) => ({
    workspaceDisplayNames: {
      ...state.workspaceDisplayNames,
      ...displayNames,
    },
  })),

// lightrag_webui/src/components/workspace/WorkspaceManagerDialog.tsx
const setWorkspaceDisplayNames = useSettingsStore.use.setWorkspaceDisplayNames()

const refresh = async () => {
  setIsLoading(true)
  try {
    const response = await listWorkspaces(true)
    setWorkspaces(response.workspaces)
    setWorkspaceDisplayNames(
      Object.fromEntries(
        response.workspaces.map((record) => [
          record.workspace,
          record.display_name || record.workspace,
        ])
      )
    )
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  } finally {
    setIsLoading(false)
  }
}

// lightrag_webui/src/components/workspace/WorkspaceSwitcher.tsx
const workspaceDisplayNames = useSettingsStore.use.workspaceDisplayNames()
const currentWorkspaceLabel =
  workspaceDisplayNames[currentWorkspace] ||
  currentWorkspace ||
  t('workspaceManager.defaultWorkspace', 'default')

return (
  <>
    <Button
      variant="outline"
      size="sm"
      className="h-8 gap-2"
      onClick={() => setOpen(true)}
    >
      <FolderKanbanIcon className="size-4" />
      <span>{currentWorkspaceLabel}</span>
    </Button>
    <WorkspaceManagerDialog open={open} onOpenChange={setOpen} />
  </>
)
```

- [ ] **Step 4: Run the switcher tests and build to verify they pass**

Run: `cd lightrag_webui && bun test src/components/workspace/WorkspaceSwitcher.test.tsx`
Expected: PASS

Run: `cd lightrag_webui && bun run build`
Expected: PASS, with only the existing Vite chunk-size warning if it still appears

- [ ] **Step 5: Commit the display-name preference**

```bash
git add lightrag_webui/src/stores/settings.ts lightrag_webui/src/components/workspace/WorkspaceManagerDialog.tsx lightrag_webui/src/components/workspace/WorkspaceSwitcher.tsx lightrag_webui/src/components/workspace/WorkspaceSwitcher.test.tsx
git commit -m "feat: prefer workspace display names"
```

## Task 3: Final Verification

**Files:**
- Modify: `tests/test_prompt_config_routes.py`
- Modify: `lightrag/api/lightrag_server.py`
- Modify: `lightrag_webui/src/stores/settings.ts`
- Modify: `lightrag_webui/src/components/workspace/WorkspaceManagerDialog.tsx`
- Modify: `lightrag_webui/src/components/workspace/WorkspaceSwitcher.tsx`
- Modify: `lightrag_webui/src/components/workspace/WorkspaceSwitcher.test.tsx`

- [ ] **Step 1: Run the combined backend and frontend verification**

Run: `./scripts/test.sh tests/test_prompt_config_routes.py -q`
Expected: PASS

Run: `cd lightrag_webui && bun test`
Expected: PASS

Run: `cd lightrag_webui && bun run build`
Expected: PASS, with only the existing chunk-size warning if it still appears

- [ ] **Step 2: Commit the verification checkpoint**

```bash
git status --short
git commit --allow-empty -m "chore: verify workspace stats and labels"
```
