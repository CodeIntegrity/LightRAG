# LightRAG Workspace Chunk Stats and Display Name Design

**Date:** 2026-03-27

**Status:** Approved for implementation planning

## Goal

Make workspace management more useful by:

- returning a real `chunk_count` in workspace stats when it can be derived cheaply from document status data
- showing `display_name` instead of the raw workspace identifier in the WebUI where the current workspace is presented to users

## Approved Product Decisions

- This iteration only upgrades `chunk_count`
- `entity_count`, `relation_count`, and `storage_size_bytes` remain best-effort unsupported fields for now
- `chunk_count` should be derived from existing document status metadata rather than by adding new count APIs to every storage backend
- WebUI display should prefer `display_name`, but all request routing and persistence should continue using the workspace key

## Scope

This design covers:

- backend `chunk_count` support in `/workspaces/{workspace}/stats`
- capability signaling for `chunk_count`
- frontend storage of workspace display metadata
- using `display_name` in the current workspace label shown to users

This design does not cover:

- cross-backend support for `entity_count`
- cross-backend support for `relation_count`
- reliable `storage_size_bytes` for remote backends
- renaming workspaces
- changing the workspace header/request contract

## Current State

Today `get_workspace_stats()` in `lightrag/api/lightrag_server.py` only computes:

- `document_count`
- `prompt_version_count`

It hardcodes:

- `entity_count = None`
- `relation_count = None`
- `chunk_count = None`
- `storage_size_bytes = None`

and marks those capabilities as `unsupported_by_backend`.

Separately, the WebUI currently shows the active workspace using the raw `currentWorkspace` string stored in `useSettingsStore`, so users see the workspace key instead of the human-friendly `display_name`.

## Chosen Approach

Use the cheapest existing source of truth for chunk statistics and keep display metadata lightweight on the client.

This means:

- backend aggregates `chunks_count` from document status storage to compute workspace `chunk_count`
- frontend caches `workspace -> display_name` after listing workspaces
- UI labels prefer the cached `display_name`, falling back to the workspace key when needed

This is preferred over adding generic count APIs to every graph/vector storage backend because it solves the immediate user-visible problem with much smaller blast radius.

## Backend Design

### `chunk_count` Derivation

`chunk_count` should be derived from document status storage, not graph/vector storage.

Reasoning:

- document status already tracks per-document `chunks_count`
- document status storage is already queried in the API layer for document-related counts
- summing `chunks_count` is much cheaper and more portable than adding new count methods to every backend

Recommended behavior:

- when workspace runtime is available, load paginated or full document status records through the existing document status storage
- sum non-null `chunks_count` values across documents in that workspace
- if the backend cannot provide document records or `chunks_count`, return `null`

Capability rules:

- if `chunk_count` is successfully derived, set `capabilities.chunk_count = "available"`
- otherwise keep `chunk_count = null` and `capabilities.chunk_count = "unsupported_by_backend"`

### Metrics Left Unchanged

This iteration should not attempt to implement:

- `entity_count`
- `relation_count`
- `storage_size_bytes`

Those fields and capabilities should remain unchanged to avoid widening the backend/storage blast radius.

## Frontend Design

### Workspace Display Metadata Cache

Add a lightweight mapping in frontend state:

- `workspaceDisplayNames: Record<string, string>`

Update flow:

- when workspace list data is loaded, normalize it into a mapping from `workspace` to `display_name`
- merge that mapping into shared frontend state

### Display Rules

Whenever the WebUI shows the current workspace to users:

- prefer `workspaceDisplayNames[currentWorkspace]`
- fallback to `currentWorkspace`
- fallback again to the localized default label if the workspace key is empty

This is presentation-only. Request headers and backend state must still use the workspace key.

### Initial Empty State

If the app has only `currentWorkspace` but not yet a cached display name:

- show the workspace key temporarily
- replace it with `display_name` once workspace metadata is loaded

## Testing Strategy

### Backend

Extend backend tests to cover:

- workspace stats returns a real `chunk_count` when document status records include `chunks_count`
- `capabilities.chunk_count` becomes `available`
- unchanged unsupported fields remain unsupported

### Frontend

Extend frontend tests to cover:

- workspace display-name mapping is stored after workspace list data is processed
- current workspace label prefers `display_name`
- fallback to workspace key still works when display metadata is missing

## Verification Commands

Expected verification after implementation:

- `./scripts/test.sh tests/test_workspace_management_routes.py -q`
- `cd lightrag_webui && bun test`
- `cd lightrag_webui && bun run build`

## Guardrails

- do not change the `LIGHTRAG-WORKSPACE` request header contract
- do not expand this task into generic entity/relation/storage size counting
- do not store `display_name` as the authoritative workspace identifier
