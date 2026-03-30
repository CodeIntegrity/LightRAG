# Guest Workspace Creation And Responsive Workspace UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in `ALLOW_GUEST_WORKSPACE_CREATE` server toggle, expose the current session’s workspace-create capability via `/health`, and make the workspace management dialog render capability-driven create states with a mobile/tablet/desktop responsive layout.

**Architecture:** Keep backend authorization authoritative by widening only the workspace create route for `guest` when the new env var is enabled, then publish the computed session capability through `/health`. On the frontend, reuse the existing health polling store, render create-state messaging from backend capability data, and adjust the workspace dialog to use a single-column segmented flow below `lg` and a split layout at `lg+`.

**Tech Stack:** Python, FastAPI, pytest via `./scripts/test.sh`, Bun, React 19, Zustand, Vitest, Vite, JSON locale files

---

## File Structure

- Modify: `lightrag/api/config.py`
  - Parse `ALLOW_GUEST_WORKSPACE_CREATE` into server args.
- Modify: `lightrag/api/routers/workspace_routes.py`
  - Add route-factory-scoped guest-create authorization and the stable `403` detail string.
- Modify: `tests/test_workspace_management_routes.py`
  - Cover guest create deny/allow behavior and guest ownership persistence.
- Modify: `lightrag/api/lightrag_server.py`
  - Pass the new config into workspace routes and expose `capabilities.workspace_create` from `/health`.
- Modify: `tests/test_prompt_config_routes.py`
  - Reuse the existing lightweight `create_app()` fixture path to verify `/health` capability output for guest/user sessions.
- Modify: `lightrag_webui/src/api/lightrag.ts`
  - Extend `LightragStatus` with `capabilities.workspace_create`.
- Modify: `lightrag_webui/src/stores/state.ts`
  - Cache backend-derived `workspaceCreateAllowed` state from the normal health check cycle.
- Modify: `lightrag_webui/src/components/workspace/WorkspaceManagerDialog.tsx`
  - Replace local guest-only create gating with backend capability gating, refresh health after a create `403`, and switch to the approved responsive breakpoints.
- Modify: `lightrag_webui/src/components/workspace/WorkspaceManagerDialog.test.tsx`
  - Cover guest allowed/denied messaging and layout class regression checks.
- Create: `lightrag_webui/src/stores/backendState.workspace.test.ts`
  - Verify `useBackendState.check()` stores `workspace_create` capability correctly.
- Modify: `lightrag_webui/src/api/lightrag.workspace.test.ts`
  - Verify the new guest-create locale keys exist in the primary locales.
- Modify: `lightrag_webui/src/locales/en.json`
  - Add English guest-create messaging.
- Modify: `lightrag_webui/src/locales/zh.json`
  - Add Chinese guest-create messaging.
- Modify: `env.example`
  - Document `ALLOW_GUEST_WORKSPACE_CREATE`.
- Modify: `env.zh.example`
  - Document `ALLOW_GUEST_WORKSPACE_CREATE` in the Chinese sample env.
- Modify: `README.md`
  - Mention guest-create opt-in behavior in the workspace management section.
- Modify: `README-zh.md`
  - Mention guest-create opt-in behavior in the Chinese workspace management section.
- Modify: `lightrag/api/README.md`
  - Document the env var, guest semantics, and `/health` capability field.
- Modify: `lightrag/api/README-zh.md`
  - Document the env var, guest semantics, and `/health` capability field in Chinese.

## Task 1: Guest Workspace Create Toggle In Workspace Routes

**Files:**
- Modify: `tests/test_workspace_management_routes.py`
- Modify: `lightrag/api/config.py`
- Modify: `lightrag/api/routers/workspace_routes.py`
- Modify: `env.example`
- Modify: `env.zh.example`

- [ ] **Step 1: Write the failing route tests for guest create deny/allow**

```python
@pytest.fixture
def workspace_app_factory(monkeypatch, tmp_path: Path):
    def _build(*, allow_guest_create: bool = False):
        monkeypatch.setattr(sys, "argv", [sys.argv[0]])
        import lightrag.api.routers.workspace_routes as workspace_routes
        from lightrag.api.workspace_registry import WorkspaceRegistryStore

        store = WorkspaceRegistryStore(tmp_path / "registry.sqlite3")
        scheduler = _DeleteScheduler()

        async def _init() -> None:
            await store.initialize(default_workspace="")
            await store.create_workspace(
                workspace="private_ws",
                display_name="Private",
                description="private",
                created_by="alice",
                visibility="private",
            )

        asyncio.run(_init())
        monkeypatch.setattr(
            workspace_routes, "get_combined_auth_dependency", lambda *_: (lambda: None)
        )

        app = FastAPI()
        app.include_router(
            workspace_routes.create_workspace_routes(
                registry_store=store,
                delete_scheduler=scheduler,
                stats_provider=lambda workspace: {
                    "document_count": 2,
                    "entity_count": None,
                    "relation_count": None,
                    "chunk_count": None,
                    "storage_size_bytes": None,
                    "prompt_version_count": 4,
                    "capabilities": {"document_count": "available"},
                },
                api_key=None,
                allow_guest_create=allow_guest_create,
            )
        )
        return TestClient(app), store, scheduler

    return _build


@pytest.fixture
def workspace_app(workspace_app_factory):
    return workspace_app_factory()


def test_create_workspace_as_guest_returns_403_when_disabled(workspace_app_factory):
    client, _, _ = workspace_app_factory(allow_guest_create=False)

    response = client.post(
        "/workspaces",
        json={
            "workspace": "guest_books",
            "display_name": "Guest Books",
            "description": "guest workspace",
            "visibility": "private",
        },
        headers={"Authorization": f"Bearer {_build_token('guest', 'guest')}"},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Workspace creation is not allowed for this session"


def test_create_workspace_as_guest_sets_creator_and_owner_when_enabled(
    workspace_app_factory,
):
    client, store, _ = workspace_app_factory(allow_guest_create=True)

    response = client.post(
        "/workspaces",
        json={
            "workspace": "guest_books",
            "display_name": "Guest Books",
            "description": "guest workspace",
            "visibility": "private",
        },
        headers={"Authorization": f"Bearer {_build_token('guest', 'guest')}"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["created_by"] == "guest"
    assert body["owners"] == ["guest"]

    stored = asyncio.run(store.get_workspace("guest_books"))
    assert stored["created_by"] == "guest"
    assert stored["owners"] == ["guest"]
```

- [ ] **Step 2: Run the backend route tests to verify they fail**

Run: `./scripts/test.sh tests/test_workspace_management_routes.py -q`
Expected: FAIL because `create_workspace_routes()` does not accept `allow_guest_create` yet and guest creation still uses `_require_user()`

- [ ] **Step 3: Implement the minimal guest-create toggle in config, routes, and env samples**

```python
# lightrag/api/config.py
args.allow_guest_workspace_create = get_env_value(
    "ALLOW_GUEST_WORKSPACE_CREATE", False, bool
)


# lightrag/api/routers/workspace_routes.py
def create_workspace_routes(
    *,
    registry_store: WorkspaceRegistryStore,
    delete_scheduler: Callable[[str, str], Awaitable[None]] | None = None,
    workspace_initializer: Callable[[str], Awaitable[None]] | None = None,
    stats_provider: Callable[[str], Any] | None = None,
    api_key: str | None = None,
    allow_guest_create: bool = False,
) -> APIRouter:
    router = APIRouter(prefix="/workspaces", tags=["workspaces"])
    combined_auth = get_combined_auth_dependency(api_key)

    def _require_workspace_creator(identity: dict[str, str | None]) -> str:
        if identity["role"] in {"user", "admin"} and identity["username"]:
            return identity["username"]
        if identity["role"] == "guest" and allow_guest_create:
            return "guest"
        raise HTTPException(
            status_code=403,
            detail="Workspace creation is not allowed for this session",
        )

    @router.post("", status_code=201, dependencies=[Depends(combined_auth)])
    async def create_workspace(payload: WorkspaceCreateRequest, request: Request):
        identity = _identity_from_request(request)
        created_by = _require_workspace_creator(identity)
        created = await registry_store.create_workspace(
            workspace=payload.workspace,
            display_name=payload.display_name,
            description=payload.description,
            created_by=created_by,
            visibility=payload.visibility,
        )
        if workspace_initializer is not None:
            await workspace_initializer(payload.workspace)
        return _normalize_workspace_response(created)
```

```dotenv
# env.example
### Allow login-free / guest sessions to create workspaces.
### Guest-created records are stored with created_by='guest' and owners=['guest'].
# ALLOW_GUEST_WORKSPACE_CREATE=false
```

```dotenv
# env.zh.example
### 是否允许免登录 / guest 会话创建 workspace。
### guest 创建的记录会写入 created_by='guest' 且 owners=['guest']。
# ALLOW_GUEST_WORKSPACE_CREATE=false
```

- [ ] **Step 4: Run the backend route tests to verify they pass**

Run: `./scripts/test.sh tests/test_workspace_management_routes.py -q`
Expected: PASS

- [ ] **Step 5: Commit the guest-create route toggle**

```bash
git add tests/test_workspace_management_routes.py lightrag/api/config.py lightrag/api/routers/workspace_routes.py env.example env.zh.example
git commit -m "feat: add guest workspace create toggle"
```

## Task 2: Expose Session-Scoped Workspace Create Capability Through `/health`

**Files:**
- Modify: `tests/test_prompt_config_routes.py`
- Modify: `lightrag/api/lightrag_server.py`

- [ ] **Step 1: Write the failing `/health` capability tests**

```python
def _build_token(username: str, role: str) -> str:
    from lightrag.api.auth import auth_handler

    return auth_handler.create_token(username, role=role)


def _build_test_client(monkeypatch, tmp_path, *, allow_guest_workspace_create: bool = False):
    monkeypatch.setattr(sys, "argv", [sys.argv[0]])

    from lightrag.api import config as api_config
    from lightrag.api import lightrag_server

    monkeypatch.setattr(lightrag_server, "LightRAG", _DummyRAG)
    monkeypatch.setattr(lightrag_server, "OllamaAPI", _DummyOllamaAPI)
    monkeypatch.setattr(
        lightrag_server, "create_document_routes", lambda *args, **kwargs: APIRouter()
    )
    monkeypatch.setattr(
        lightrag_server, "create_query_routes", lambda *args, **kwargs: APIRouter()
    )
    monkeypatch.setattr(
        lightrag_server, "create_graph_routes", lambda *args, **kwargs: APIRouter()
    )
    monkeypatch.setattr(lightrag_server, "check_frontend_build", lambda: (False, False))
    monkeypatch.setattr(
        lightrag_server, "get_combined_auth_dependency", lambda *_: (lambda: None)
    )
    monkeypatch.setattr(
        lightrag_server, "global_args", SimpleNamespace(cors_origins="*")
    )
    monkeypatch.setattr(lightrag_server, "get_default_workspace", lambda: "default")
    monkeypatch.setattr(lightrag_server, "cleanup_keyed_lock", lambda: {})

    async def _fake_get_namespace_data(*args, **kwargs):
        return {"busy": False}

    monkeypatch.setattr(lightrag_server, "get_namespace_data", _fake_get_namespace_data)

    args = api_config.parse_args()
    args.workspace_registry_path = str(tmp_path / "workspaces" / "registry.sqlite3")
    args.allow_guest_workspace_create = allow_guest_workspace_create
    app = lightrag_server.create_app(args)
    return TestClient(app)


def test_health_exposes_workspace_create_capability_for_guest_when_enabled(
    monkeypatch, tmp_path
):
    with _build_test_client(
        monkeypatch, tmp_path, allow_guest_workspace_create=True
    ) as client:
        response = client.get(
            "/health",
            headers={"Authorization": f"Bearer {_build_token('guest', 'guest')}"},
        )

    assert response.status_code == 200
    assert response.json()["capabilities"]["workspace_create"] is True


def test_health_exposes_workspace_create_capability_for_guest_when_disabled(
    monkeypatch, tmp_path
):
    with _build_test_client(
        monkeypatch, tmp_path, allow_guest_workspace_create=False
    ) as client:
        response = client.get(
            "/health",
            headers={"Authorization": f"Bearer {_build_token('guest', 'guest')}"},
        )

    assert response.status_code == 200
    assert response.json()["capabilities"]["workspace_create"] is False


def test_health_exposes_workspace_create_capability_for_logged_in_user(
    monkeypatch, tmp_path
):
    with _build_test_client(
        monkeypatch, tmp_path, allow_guest_workspace_create=False
    ) as client:
        response = client.get(
            "/health",
            headers={"Authorization": f"Bearer {_build_token('alice', 'user')}"},
        )

    assert response.status_code == 200
    assert response.json()["capabilities"]["workspace_create"] is True
```

- [ ] **Step 2: Run the `/health` capability tests to verify they fail**

Run: `./scripts/test.sh tests/test_prompt_config_routes.py -q`
Expected: FAIL because `/health` does not return `capabilities.workspace_create` and `create_app()` does not pass `allow_guest_create` into `create_workspace_routes()`

- [ ] **Step 3: Wire the new config into the server and compute session capability in `/health`**

```python
# lightrag/api/lightrag_server.py
app.include_router(
    create_workspace_routes(
        registry_store=workspace_registry,
        delete_scheduler=delete_workspace_data,
        workspace_initializer=initialize_workspace_assets,
        stats_provider=get_workspace_stats,
        api_key=api_key,
        allow_guest_create=args.allow_guest_workspace_create,
    )
)


def _workspace_create_capability_for_request(request: Request) -> bool:
    authorization = request.headers.get("Authorization", "").strip()
    if not authorization:
        return args.allow_guest_workspace_create
    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authorization header",
        )

    token_info = auth_handler.validate_token(
        authorization.removeprefix("Bearer ").strip()
    )
    role = token_info.get("role", "user")
    username = token_info.get("username")
    if role in {"user", "admin"} and username:
        return True
    return role == "guest" and args.allow_guest_workspace_create


@app.get("/health", dependencies=[Depends(combined_auth)])
async def get_status(request: Request):
    workspace = resolve_request_workspace(request)
    pipeline_status = await get_namespace_data("pipeline_status", workspace=workspace)
    return {
        "status": "healthy",
        "webui_available": webui_assets_exist,
        "working_directory": str(args.working_dir),
        "input_directory": str(args.input_dir),
        "configuration": {
            "llm_binding": args.llm_binding,
            "llm_binding_host": args.llm_binding_host,
            "llm_model": args.llm_model,
            "embedding_binding": args.embedding_binding,
            "embedding_binding_host": args.embedding_binding_host,
            "embedding_model": args.embedding_model,
            "summary_max_tokens": args.summary_max_tokens,
            "summary_context_size": args.summary_context_size,
            "kv_storage": args.kv_storage,
            "doc_status_storage": args.doc_status_storage,
            "graph_storage": args.graph_storage,
            "vector_storage": args.vector_storage,
            "enable_llm_cache_for_extract": args.enable_llm_cache_for_extract,
            "enable_llm_cache": args.enable_llm_cache,
            "workspace": workspace,
            "max_graph_nodes": args.max_graph_nodes,
            "enable_rerank": rerank_model_func is not None,
            "rerank_binding": args.rerank_binding,
            "rerank_model": args.rerank_model if rerank_model_func else None,
            "rerank_binding_host": args.rerank_binding_host if rerank_model_func else None,
            "summary_language": args.summary_language,
            "force_llm_summary_on_merge": args.force_llm_summary_on_merge,
            "max_parallel_insert": args.max_parallel_insert,
            "cosine_threshold": args.cosine_threshold,
            "min_rerank_score": args.min_rerank_score,
            "related_chunk_number": args.related_chunk_number,
            "max_async": args.max_async,
            "embedding_func_max_async": args.embedding_func_max_async,
            "embedding_batch_num": args.embedding_batch_num,
            "allow_prompt_overrides_via_api": args.allow_prompt_overrides_via_api,
            "active_prompt_versions": active_prompt_versions,
        },
        "capabilities": {
            "workspace_create": _workspace_create_capability_for_request(request),
        },
        "auth_mode": auth_mode,
        "pipeline_busy": pipeline_status.get("busy", False),
        "keyed_locks": keyed_lock_info,
        "core_version": core_version,
        "api_version": api_version_display,
        "webui_title": webui_title,
        "webui_description": webui_description,
    }
```

- [ ] **Step 4: Run the `/health` capability tests to verify they pass**

Run: `./scripts/test.sh tests/test_prompt_config_routes.py -q`
Expected: PASS

- [ ] **Step 5: Commit the `/health` capability exposure**

```bash
git add tests/test_prompt_config_routes.py lightrag/api/lightrag_server.py
git commit -m "feat: expose workspace create capability in health"
```

## Task 3: Frontend Health-State Plumbing And Locale Coverage

**Files:**
- Create: `lightrag_webui/src/stores/backendState.workspace.test.ts`
- Modify: `lightrag_webui/src/api/lightrag.ts`
- Modify: `lightrag_webui/src/stores/state.ts`
- Modify: `lightrag_webui/src/api/lightrag.workspace.test.ts`
- Modify: `lightrag_webui/src/locales/en.json`
- Modify: `lightrag_webui/src/locales/zh.json`

- [ ] **Step 1: Write the failing frontend state and locale tests**

```ts
// lightrag_webui/src/stores/backendState.workspace.test.ts
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/lightrag', async () => {
  const actual = await vi.importActual<typeof import('@/api/lightrag')>('@/api/lightrag')
  return Object.assign({}, actual, {
    checkHealth: vi.fn(),
  })
})

describe('backend workspace create capability', () => {
  afterEach(async () => {
    const { useBackendState } = await import('./state')
    useBackendState.setState({
      workspaceCreateAllowed: false,
      status: null,
      message: null,
      messageTitle: null,
      allowPromptOverridesViaApi: false,
      activePromptVersions: null,
      pipelineBusy: false,
    } as any)
  })

  test('check stores workspace_create capability from health response', async () => {
    const api = await import('@/api/lightrag')
    const checkHealthMock = api.checkHealth as unknown as ReturnType<typeof vi.fn>
    const { useBackendState } = await import('./state')

    checkHealthMock.mockResolvedValue({
      status: 'healthy',
      working_directory: '/tmp/rag',
      input_directory: '/tmp/input',
      configuration: {
        llm_binding: 'ollama',
        llm_binding_host: '',
        llm_model: 'demo',
        embedding_binding: 'ollama',
        embedding_binding_host: '',
        embedding_model: 'demo',
        kv_storage: 'JsonKVStorage',
        doc_status_storage: 'JsonDocStatusStorage',
        graph_storage: 'NetworkXStorage',
        vector_storage: 'NanoVectorDBStorage',
        workspace: '',
        max_graph_nodes: '1000',
        enable_rerank: false,
        rerank_binding: null,
        rerank_model: null,
        rerank_binding_host: null,
        summary_language: 'en',
        force_llm_summary_on_merge: false,
        max_parallel_insert: 2,
        max_async: 4,
        embedding_func_max_async: 4,
        embedding_batch_num: 8,
        cosine_threshold: 0.2,
        min_rerank_score: 0,
        related_chunk_number: 5,
      },
      capabilities: {
        workspace_create: true,
      },
      pipeline_busy: false,
    })

    const ok = await useBackendState.getState().check()
    expect(ok).toBe(true)
    expect(useBackendState.getState().workspaceCreateAllowed).toBe(true)
  })
})

// lightrag_webui/src/api/lightrag.workspace.test.ts
test('guest workspace create copy exists in primary locales', () => {
  const getValueAtPath = (obj: Record<string, unknown>, path: string): unknown =>
    path.split('.').reduce<unknown>((current, segment) => {
      if (current && typeof current === 'object') {
        return (current as Record<string, unknown>)[segment]
      }
      return undefined
    }, obj)

  ;[en, zh].forEach((locale) => {
    expect(getValueAtPath(locale as Record<string, unknown>, 'workspaceManager.guestCreateHint')).toBeTruthy()
    expect(getValueAtPath(locale as Record<string, unknown>, 'workspaceManager.loginRequiredHint')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the frontend state and locale tests to verify they fail**

Run: `cd lightrag_webui && bun test src/stores/backendState.workspace.test.ts src/api/lightrag.workspace.test.ts`
Expected: FAIL because `LightragStatus` does not include `capabilities`, `useBackendState` does not persist `workspaceCreateAllowed`, and the new locale keys do not exist yet

- [ ] **Step 3: Implement the health capability type, Zustand field, and locale strings**

```ts
// lightrag_webui/src/api/lightrag.ts
export type LightragStatus = {
  status: 'healthy'
  working_directory: string
  input_directory: string
  configuration: {
    llm_binding: string
    llm_binding_host: string
    llm_model: string
    embedding_binding: string
    embedding_binding_host: string
    embedding_model: string
    kv_storage: string
    doc_status_storage: string
    graph_storage: string
    vector_storage: string
    workspace?: string
    max_graph_nodes?: string
    enable_rerank?: boolean
    rerank_binding?: string | null
    rerank_model?: string | null
    rerank_binding_host?: string | null
    summary_language: string
    force_llm_summary_on_merge: boolean
    max_parallel_insert: number
    max_async: number
    embedding_func_max_async: number
    embedding_batch_num: number
    cosine_threshold: number
    min_rerank_score: number
    related_chunk_number: number
    allow_prompt_overrides_via_api?: boolean
    active_prompt_versions?: Record<PromptConfigGroup, ActivePromptVersionSummary>
  }
  capabilities?: {
    workspace_create?: boolean
  }
  pipeline_busy: boolean
}

// lightrag_webui/src/stores/state.ts
// add to BackendState
workspaceCreateAllowed: boolean

// add to the initial store object
workspaceCreateAllowed: false,

// add to the success path inside check()
workspaceCreateAllowed: health.capabilities?.workspace_create === true,

// add to the error path inside check()
workspaceCreateAllowed: false,

// add to clear()
workspaceCreateAllowed: false,

const useBackendStateStoreBase = create<BackendState>()((set, get) => ({
  check: async () => {
    const health = await checkHealth()
    if (health.status === 'healthy') {
      set({
        health: true,
        message: null,
        messageTitle: null,
        lastCheckTime: Date.now(),
        status: health,
        allowPromptOverridesViaApi: health.configuration?.allow_prompt_overrides_via_api === true,
        activePromptVersions: health.configuration?.active_prompt_versions || null,
        workspaceCreateAllowed: health.capabilities?.workspace_create === true,
        pipelineBusy: health.pipeline_busy
      })
      return true
    }
    set({
      health: false,
      message: health.message,
      messageTitle: 'Backend Health Check Error!',
      lastCheckTime: Date.now(),
      status: null,
      allowPromptOverridesViaApi: false,
      activePromptVersions: null,
      workspaceCreateAllowed: false,
    })
    return false
  },
  clear: () => {
    set({
      health: true,
      message: null,
      messageTitle: null,
      allowPromptOverridesViaApi: false,
      activePromptVersions: null,
      workspaceCreateAllowed: false,
    })
  },
}))
```

```json
// lightrag_webui/src/locales/en.json
"guestCreateHint": "This workspace will be created as guest.",
"loginRequiredHint": "Log in to create workspaces."

// lightrag_webui/src/locales/zh.json
"guestCreateHint": "当前将以 guest 身份创建工作区。",
"loginRequiredHint": "请先登录后再创建工作区。"
```

- [ ] **Step 4: Run the frontend state and locale tests to verify they pass**

Run: `cd lightrag_webui && bun test src/stores/backendState.workspace.test.ts src/api/lightrag.workspace.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the frontend health-state plumbing**

```bash
git add lightrag_webui/src/stores/backendState.workspace.test.ts lightrag_webui/src/api/lightrag.ts lightrag_webui/src/stores/state.ts lightrag_webui/src/api/lightrag.workspace.test.ts lightrag_webui/src/locales/en.json lightrag_webui/src/locales/zh.json
git commit -m "feat: plumb workspace create capability to webui state"
```

## Task 4: Make Workspace Dialog Capability-Driven And Responsive

**Files:**
- Modify: `lightrag_webui/src/components/workspace/WorkspaceManagerDialog.tsx`
- Modify: `lightrag_webui/src/components/workspace/WorkspaceManagerDialog.test.tsx`

- [ ] **Step 1: Write the failing dialog tests for guest capability states and breakpoints**

```tsx
test('shows guest create hint and enabled button when backend capability allows it', async () => {
  const { useBackendState } = await import('@/stores/state')
  useBackendState.setState({
    workspaceCreateAllowed: true,
  } as any)

  const getItemMock = localStorage.getItem as unknown as ReturnType<typeof vi.fn>
  getItemMock.mockImplementation((key: string) =>
    key === 'LIGHTRAG-API-TOKEN'
      ? 'header.eyJyb2xlIjoiZ3Vlc3QiLCJzdWIiOiJndWVzdCJ9.signature'
      : null
  )

  const ReactModule = await import('react')
  const actualUseState = ReactModule.useState
  const noop = () => undefined

  vi.spyOn(ReactModule, 'useState')
    .mockImplementationOnce((() => [[], noop]) as never)
    .mockImplementationOnce((() => [false, noop]) as never)
    .mockImplementationOnce((() => ['guest_ws', noop]) as never)
    .mockImplementationOnce((() => ['Guest WS', noop]) as never)
    .mockImplementationOnce((() => ['guest workspace', noop]) as never)
    .mockImplementationOnce((() => ['private', noop]) as never)
    .mockImplementationOnce((() => [{}, noop]) as never)
    .mockImplementationOnce((() => [{}, noop]) as never)
    .mockImplementation(actualUseState as never)

  const module = await import('./WorkspaceManagerDialog')
  const html = renderToString(<module.default open onOpenChange={() => undefined} />)

  expect(html).toContain('This workspace will be created as guest.')
  expect(html).not.toContain('disabled=""')
})

test('shows login-required hint and disabled button when guest create capability is false', async () => {
  const { useBackendState } = await import('@/stores/state')
  useBackendState.setState({
    workspaceCreateAllowed: false,
  } as any)

  const getItemMock = localStorage.getItem as unknown as ReturnType<typeof vi.fn>
  getItemMock.mockImplementation((key: string) =>
    key === 'LIGHTRAG-API-TOKEN'
      ? 'header.eyJyb2xlIjoiZ3Vlc3QiLCJzdWIiOiJndWVzdCJ9.signature'
      : null
  )

  const ReactModule = await import('react')
  const actualUseState = ReactModule.useState
  const noop = () => undefined

  vi.spyOn(ReactModule, 'useState')
    .mockImplementationOnce((() => [[], noop]) as never)
    .mockImplementationOnce((() => [false, noop]) as never)
    .mockImplementationOnce((() => ['guest_ws', noop]) as never)
    .mockImplementationOnce((() => ['Guest WS', noop]) as never)
    .mockImplementationOnce((() => ['guest workspace', noop]) as never)
    .mockImplementationOnce((() => ['private', noop]) as never)
    .mockImplementationOnce((() => [{}, noop]) as never)
    .mockImplementationOnce((() => [{}, noop]) as never)
    .mockImplementation(actualUseState as never)

  const module = await import('./WorkspaceManagerDialog')
  const html = renderToString(<module.default open onOpenChange={() => undefined} />)

  expect(html).toContain('Log in to create workspaces.')
  expect(html).toContain('disabled=""')
})

test('uses the approved responsive breakpoints for overview and main layout', async () => {
  const module = await import('./WorkspaceManagerDialog')
  const html = renderToString(<module.default open onOpenChange={() => undefined} />)

  expect(html).toContain('sm:grid-cols-2 lg:grid-cols-3')
  expect(html).toContain('lg:grid-cols-[minmax(320px,360px)_minmax(0,1fr)]')
  expect(html).not.toContain('xl:grid-cols-[minmax(320px,360px)_minmax(0,1fr)]')
})
```

- [ ] **Step 2: Run the dialog tests to verify they fail**

Run: `cd lightrag_webui && bun test src/components/workspace/WorkspaceManagerDialog.test.tsx`
Expected: FAIL because the dialog still gates create by local guest role and still uses the old breakpoint classes

- [ ] **Step 3: Implement capability-driven create state, 403 refresh, and responsive breakpoints**

```tsx
// lightrag_webui/src/components/workspace/WorkspaceManagerDialog.tsx
import { useBackendState } from '@/stores/state'

export default function WorkspaceManagerDialog({ open, onOpenChange }: WorkspaceManagerDialogProps) {
  const { t } = useTranslation()
  const currentWorkspace = useSettingsStore.use.currentWorkspace()
  const setCurrentWorkspace = useSettingsStore.use.setCurrentWorkspace()
  const workspaceCreateAllowed = useBackendState.use.workspaceCreateAllowed()
  const role = useMemo(() => getJwtRole(localStorage.getItem('LIGHTRAG-API-TOKEN')), [open])
  const isAdmin = role === 'admin'
  const isGuestMode = role === 'guest' || role === null

  const createHint =
    isGuestMode && workspaceCreateAllowed
      ? t('workspaceManager.guestCreateHint', 'This workspace will be created as guest.')
      : isGuestMode
        ? t('workspaceManager.loginRequiredHint', 'Log in to create workspaces.')
        : null

  const canCreateWorkspace = workspace.trim().length > 0 && workspaceCreateAllowed

  const handleCreate = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    if (!canCreateWorkspace) {
      return
    }

    try {
      await createWorkspace({
        workspace: workspace.trim(),
        display_name: displayName.trim() || workspace.trim(),
        description: description.trim(),
        visibility,
      })
      toast.success(t('workspaceManager.createSuccess', 'Workspace created'))
      setWorkspace('')
      setDisplayName('')
      setDescription('')
      await refresh()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(message)
      if (
        message.includes('/workspaces') &&
        message.includes('Workspace creation is not allowed for this session')
      ) {
        void useBackendState.getState().check()
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-6xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border/60 px-6 py-5">
          <DialogTitle>{t('workspaceManager.title', 'Workspace Management')}</DialogTitle>
          <DialogDescription>
            {t('workspaceManager.description', 'Create, switch, and manage workspaces for the current server.')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 overflow-y-auto px-6 py-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/60 p-4">
              <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {t('workspaceManager.summary.total', 'Total workspaces')}
              </div>
              <div className="mt-3 text-3xl font-semibold">{workspaces.length}</div>
              <div className="text-muted-foreground mt-1 text-xs">
                {t('workspaceManager.readyTitle', 'Workspaces')}: {readyWorkspaces.length}
              </div>
            </div>
            <div className="rounded-xl border border-border/70 bg-background/80 p-4">
              <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {t('workspaceManager.summary.current', 'Active workspace')}
              </div>
              <div className="mt-3 truncate text-lg font-semibold">{currentWorkspaceLabel}</div>
              <div className="text-muted-foreground mt-1 text-xs">
                {currentWorkspace || t('workspaceManager.defaultWorkspace', 'default')}
              </div>
            </div>
            <div className="rounded-xl border border-amber-200/70 bg-amber-50/60 p-4">
              <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {t('workspaceManager.summary.pending', 'Pending changes')}
              </div>
              <div className="mt-3 text-3xl font-semibold">{deletedWorkspaces.length}</div>
              <div className="text-muted-foreground mt-1 text-xs">
                {t('workspaceManager.deletedTitle', 'Deleted / Pending')}
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(320px,360px)_minmax(0,1fr)]">
            <section className="space-y-6">
              <Card className="overflow-hidden border-emerald-200/70 shadow-sm">
                <CardHeader className="bg-emerald-50/50 pb-4">
                  <CardTitle className="text-base">{t('workspaceManager.createTitle', 'Create Workspace')}</CardTitle>
                  <CardDescription>
                    {t(
                      'workspaceManager.createDescription',
                      'Set a stable workspace key, a friendly display name, and the visibility you want to share.'
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-6">
                  <form className="space-y-4" onSubmit={(event) => void handleCreate(event)}>
                    <Input
                      id="workspace-name"
                      value={workspace}
                      onChange={(event) => setWorkspace(event.target.value)}
                      placeholder={t('workspaceManager.workspacePlaceholder', 'workspace_name')}
                      className="h-10"
                    />
                    <Input
                      id="workspace-display-name"
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      placeholder={t('workspaceManager.displayNamePlaceholder', 'Display name')}
                      className="h-10"
                    />
                    <textarea
                      id="workspace-description"
                      className="border-input placeholder:text-muted-foreground focus-visible:ring-ring min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-sm transition-colors focus-visible:ring-1 focus-visible:outline-none"
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder={t('workspaceManager.descriptionPlaceholder', 'Description')}
                    />
                    <select
                      id="workspace-visibility"
                      className="border-input bg-background h-10 w-full rounded-md border px-3 py-2 text-sm"
                      value={visibility}
                      onChange={(event) => setVisibility(event.target.value as WorkspaceVisibility)}
                    >
                      <option value="private">{t('workspaceManager.private', 'Private')}</option>
                      <option value="public">{t('workspaceManager.public', 'Public')}</option>
                    </select>
```
              {createHint && (
                <div className="text-muted-foreground bg-muted/40 rounded-md border border-dashed px-3 py-2 text-xs">
                  {createHint}
                </div>
              )}
              <Button className="h-10 w-full" type="submit" disabled={!canCreateWorkspace}>
                {t('workspaceManager.create', 'Create Workspace')}
              </Button>
            </form>
          </CardContent>
        </Card>
      </section>
    </div>
  </div>
```
            </section>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Run the dialog tests and a production build to verify they pass**

Run: `cd lightrag_webui && bun test src/components/workspace/WorkspaceManagerDialog.test.tsx && bun run build`
Expected: PASS, with only the existing large-chunk warning from Vite if it still appears

- [ ] **Step 5: Commit the workspace dialog UI update**

```bash
git add lightrag_webui/src/components/workspace/WorkspaceManagerDialog.tsx lightrag_webui/src/components/workspace/WorkspaceManagerDialog.test.tsx
git commit -m "feat: add capability-driven workspace create ui"
```

## Task 5: Update Docs And Run Final Verification

**Files:**
- Modify: `env.example`
- Modify: `env.zh.example`
- Modify: `README.md`
- Modify: `README-zh.md`
- Modify: `lightrag/api/README.md`
- Modify: `lightrag/api/README-zh.md`

- [ ] **Step 1: Update env samples and docs with the new guest-create behavior**

```md
<!-- README.md / README-zh.md workspace section -->
- guest/login-free workspace creation can be enabled explicitly with `ALLOW_GUEST_WORKSPACE_CREATE=true`
- guest-created workspaces are recorded with `created_by='guest'` and `owners=['guest']`

<!-- lightrag/api/README.md -->
`/health` now also exposes `capabilities.workspace_create`, which tells the current session whether workspace creation is allowed.

`POST /workspaces` accepts `guest` sessions only when `ALLOW_GUEST_WORKSPACE_CREATE=true`.
When enabled, guest-created records are stored with `created_by='guest'` and `owners=['guest']`.

<!-- lightrag/api/README-zh.md -->
`/health` 现在还会暴露 `capabilities.workspace_create`，表示当前会话是否允许创建 workspace。

只有在 `ALLOW_GUEST_WORKSPACE_CREATE=true` 时，`POST /workspaces` 才允许 guest 会话创建 workspace。
启用后，guest 创建的记录会写入 `created_by='guest'` 且 `owners=['guest']`。
```

- [ ] **Step 2: Run the complete verification set**

Run: `./scripts/test.sh tests/test_workspace_management_routes.py tests/test_prompt_config_routes.py -q`
Expected: PASS

Run: `cd lightrag_webui && bun test`
Expected: PASS

Run: `cd lightrag_webui && bun run build`
Expected: PASS, with only the pre-existing chunk-size warning if still emitted

- [ ] **Step 3: Commit the docs and verification pass**

```bash
git add env.example env.zh.example README.md README-zh.md lightrag/api/README.md lightrag/api/README-zh.md
git commit -m "docs: document guest workspace creation toggle"
```
