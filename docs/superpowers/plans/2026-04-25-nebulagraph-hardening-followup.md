# NebulaGraph Hardening Follow-up Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` when implementing this plan. Track progress with checkbox updates.

**Goal:** Close the remaining NebulaGraph support gaps around contract consistency, misleading configuration, startup cost, and broken developer documentation so the next implementation pass can proceed without re-discovery work.

**Architecture:** Keep `NebulaGraphStorage` as the graph-only backend, but tighten the environment contract across runtime/setup/tests, remove or correctly wire unsupported knobs, separate provisioning work from normal startup, reduce implicit listener discovery, and repair the user-facing docs/examples.

**Tech Stack:** Python 3.10+, `nebula3-python`, LightRAG storage abstractions, setup wizard Bash scripts, pytest, ruff, Markdown docs

---

## File Map

### Modify

- `lightrag/kg/nebula_impl.py`
- `lightrag/kg/__init__.py`
- `scripts/setup/lib/storage_requirements.sh`
- `scripts/setup/setup.sh`
- `tests/test_graph_storage.py`
- `tests/test_nebula_graph_storage.py`
- `README.md`
- `README-zh.md`
- `env.example`

### Create or Decide

- `examples/lightrag_openai_nebula_demo.py` or remove its documentation references

### Verify Against

- `scripts/setup/lib/validation.sh`
- `docs/superpowers/specs/2026-03-24-nebulagraph-support-design.md`
- `docs/superpowers/plans/2026-03-25-nebulagraph-review-followup.md`

## Current Findings To Carry Forward

- Runtime accepts empty `NEBULA_PASSWORD`, but generic integration gating and setup requirements do not express the same contract.
- `NEBULA_SSL` is collected and documented, but current backend wiring does not apply it to the Nebula client configuration.
- `initialize()` still performs provisioning-heavy work including space/schema/index creation and full-text rebuild on the normal startup path.
- README currently references `examples/lightrag_openai_nebula_demo.py`, but the file is missing.

## Task 1: Unify Nebula Environment Contract

**Files:**
- Modify: `lightrag/kg/__init__.py`
- Modify: `scripts/setup/lib/storage_requirements.sh`
- Modify: `tests/test_graph_storage.py`
- Modify: `tests/test_nebula_graph_storage.py`
- Modify: `README.md`
- Modify: `README-zh.md`
- Modify: `env.example`

- [ ] Define one canonical rule for `NEBULA_HOSTS`, `NEBULA_USER`, and `NEBULA_PASSWORD`.
- [ ] Keep support for empty-string `NEBULA_PASSWORD` if runtime remains password-optional for some deployments.
- [ ] Update generic graph-storage integration gating so empty password is not treated as missing.
- [ ] Align setup metadata and docs with the same rule.
- [ ] Add regression coverage proving the contract is consistent across backend registration and integration checks.

## Task 2: Resolve `NEBULA_SSL` False Advertising

**Files:**
- Modify: `lightrag/kg/nebula_impl.py`
- Modify: `scripts/setup/setup.sh`
- Modify: `README.md`
- Modify: `README-zh.md`
- Modify: `env.example`
- Modify: `tests/test_nebula_graph_storage.py`

- [ ] Verify whether `nebula3-python` exposes a real SSL/TLS option compatible with the current connection path.
- [ ] If supported, wire `NEBULA_SSL` into the actual client config and add tests.
- [ ] If unsupported, remove or explicitly deprecate the setting from setup flow and docs.
- [ ] Ensure the final user-facing contract does not claim SSL support that the runtime does not provide.

## Task 3: Split Provisioning From Normal Initialization

**Files:**
- Modify: `lightrag/kg/nebula_impl.py`
- Modify: `tests/test_nebula_graph_storage.py`
- Verify: `tests/test_graph_storage.py`

- [ ] Separate lightweight startup readiness from heavy provisioning operations.
- [ ] Define when to create spaces/schema/indexes automatically and when to skip rebuild work.
- [ ] Prevent routine startup from always triggering index rebuild paths.
- [ ] Preserve idempotency and current public storage behavior.
- [ ] Add focused tests around initialization mode, readiness checks, and no-regression behavior.

## Task 4: Reduce Implicit Listener Discovery

**Files:**
- Modify: `lightrag/kg/nebula_impl.py`
- Modify: `README.md`
- Modify: `README-zh.md`
- Modify: `env.example`
- Modify: `tests/test_nebula_graph_storage.py`

- [ ] Keep `NEBULA_LISTENER_HOSTS` as the preferred explicit path.
- [ ] Reassess cross-space listener auto-discovery and narrow or disable it by default if it adds hidden startup cost.
- [ ] Document the exact fallback behavior that remains.
- [ ] Add tests for the chosen precedence and failure-path logging.

## Task 5: Repair Nebula Onboarding Docs

**Files:**
- Modify: `README.md`
- Modify: `README-zh.md`
- Modify or Create: `examples/lightrag_openai_nebula_demo.py`
- Modify: `tests/test_nebula_graph_storage.py`

- [ ] Decide whether to add the missing example script or remove the dangling README reference.
- [ ] Make the onboarding path executable from docs alone.
- [ ] Keep the docs explicit about full-text prerequisites and degraded fallback behavior.
- [ ] Add or update doc assertions in Nebula tests so the broken reference cannot regress silently.

## Task 6: Final Verification

**Files:**
- Verify: `lightrag/kg/nebula_impl.py`
- Verify: `lightrag/kg/__init__.py`
- Verify: `scripts/setup/lib/storage_requirements.sh`
- Verify: `scripts/setup/setup.sh`
- Verify: `tests/test_graph_storage.py`
- Verify: `tests/test_nebula_graph_storage.py`
- Verify: `README.md`
- Verify: `README-zh.md`
- Verify: `env.example`

- [ ] Run:

```bash
./scripts/test.sh tests/test_nebula_graph_storage.py -v
./scripts/test.sh tests/test_graph_storage.py -v -k Nebula
uv run ruff check lightrag/kg/nebula_impl.py lightrag/kg/__init__.py tests/test_graph_storage.py tests/test_nebula_graph_storage.py
```

Expected: PASS

- [ ] If setup files change, also run:

```bash
./scripts/test.sh tests/test_interactive_setup_outputs.py -v
```

Expected: PASS

- [ ] If a real Nebula cluster is available, additionally run:

```bash
LIGHTRAG_GRAPH_STORAGE=NebulaGraphStorage ./scripts/test.sh tests/test_graph_storage.py -v --run-integration
```

Expected: PASS against a real Nebula environment.

## Exit Criteria

- Nebula runtime, setup, tests, and docs describe the same connection contract.
- No documented Nebula setting remains unimplemented or misleading.
- Normal initialization avoids unnecessary provisioning-heavy rebuild work.
- Listener behavior is explicit rather than surprising.
- Nebula onboarding docs no longer contain broken references.
