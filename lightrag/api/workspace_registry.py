from __future__ import annotations

import asyncio
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class WorkspaceRegistryError(ValueError):
    """Base exception for workspace registry errors."""


class WorkspaceAlreadyExistsError(WorkspaceRegistryError):
    """Raised when trying to create an existing workspace."""


class WorkspaceNotFoundError(WorkspaceRegistryError):
    """Raised when workspace metadata does not exist."""


class WorkspaceStateTransitionError(WorkspaceRegistryError):
    """Raised when a workspace cannot move into the requested state."""


class WorkspaceRegistryStore:
    def __init__(self, db_path: str | Path, busy_timeout_ms: int = 5000) -> None:
        self.db_path = Path(db_path)
        self.busy_timeout_ms = busy_timeout_ms

    def _connect(self) -> sqlite3.Connection:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute(f"PRAGMA busy_timeout = {int(self.busy_timeout_ms)}")
        return conn

    async def initialize(self, default_workspace: str) -> None:
        await asyncio.to_thread(self._initialize_sync, default_workspace)

    def _initialize_sync(self, default_workspace: str) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS workspaces (
                    workspace TEXT PRIMARY KEY,
                    display_name TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL,
                    visibility TEXT NOT NULL DEFAULT 'public',
                    created_by TEXT,
                    owners_json TEXT NOT NULL DEFAULT '[]',
                    is_default INTEGER NOT NULL DEFAULT 0,
                    is_protected INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    deleted_at TEXT,
                    deleted_by TEXT,
                    delete_error TEXT
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS workspace_operations (
                    workspace TEXT PRIMARY KEY REFERENCES workspaces(workspace) ON DELETE CASCADE,
                    kind TEXT,
                    state TEXT NOT NULL,
                    requested_by TEXT,
                    started_at TEXT,
                    finished_at TEXT,
                    error TEXT,
                    progress_json TEXT NOT NULL DEFAULT '{}'
                )
                """
            )

            existing = conn.execute(
                "SELECT workspace FROM workspaces WHERE workspace = ?",
                (default_workspace,),
            ).fetchone()
            if existing is None:
                now = _utc_now()
                default_label = default_workspace or "default"
                conn.execute(
                    """
                    INSERT INTO workspaces (
                        workspace,
                        display_name,
                        description,
                        status,
                        visibility,
                        created_by,
                        owners_json,
                        is_default,
                        is_protected,
                        created_at,
                        updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        default_workspace,
                        default_label,
                        "Primary workspace",
                        "ready",
                        "public",
                        "system",
                        json.dumps(["system"]),
                        1,
                        1,
                        now,
                        now,
                    ),
                )
                conn.execute(
                    """
                    INSERT INTO workspace_operations (
                        workspace,
                        kind,
                        state,
                        requested_by,
                        started_at,
                        finished_at,
                        error,
                        progress_json
                    ) VALUES (?, NULL, 'idle', NULL, NULL, NULL, NULL, '{}')
                    """,
                    (default_workspace,),
                )
                conn.commit()

    async def list_workspaces(self) -> list[dict[str, Any]]:
        rows = await asyncio.to_thread(self._list_workspaces_sync)
        return [self._row_to_record(row) for row in rows]

    def _list_workspaces_sync(self) -> list[sqlite3.Row]:
        with self._connect() as conn:
            return conn.execute(
                "SELECT * FROM workspaces ORDER BY is_default DESC, workspace ASC"
            ).fetchall()

    async def get_workspace(self, workspace: str) -> dict[str, Any]:
        row = await asyncio.to_thread(self._get_workspace_sync, workspace)
        if row is None:
            raise WorkspaceNotFoundError(f"Workspace '{workspace}' not found")
        return self._row_to_record(row)

    def _get_workspace_sync(self, workspace: str) -> sqlite3.Row | None:
        with self._connect() as conn:
            return conn.execute(
                "SELECT * FROM workspaces WHERE workspace = ?",
                (workspace,),
            ).fetchone()

    async def create_workspace(
        self,
        workspace: str,
        display_name: str,
        description: str,
        created_by: str,
        visibility: str = "public",
    ) -> dict[str, Any]:
        await asyncio.to_thread(
            self._create_workspace_sync,
            workspace,
            display_name,
            description,
            created_by,
            visibility,
        )
        return await self.get_workspace(workspace)

    async def soft_delete_workspace(
        self, workspace: str, deleted_by: str
    ) -> dict[str, Any]:
        await asyncio.to_thread(self._soft_delete_workspace_sync, workspace, deleted_by)
        return await self.get_workspace(workspace)

    def _soft_delete_workspace_sync(self, workspace: str, deleted_by: str) -> None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT status, is_protected FROM workspaces WHERE workspace = ?",
                (workspace,),
            ).fetchone()
            if row is None:
                raise WorkspaceNotFoundError(f"Workspace '{workspace}' not found")
            if row["is_protected"]:
                raise WorkspaceStateTransitionError(
                    f"Workspace '{workspace}' is protected"
                )
            if row["status"] != "ready":
                raise WorkspaceStateTransitionError(
                    f"Workspace '{workspace}' is not in ready state"
                )

            now = _utc_now()
            conn.execute(
                """
                UPDATE workspaces
                SET status = 'soft_deleted',
                    updated_at = ?,
                    deleted_at = ?,
                    deleted_by = ?,
                    delete_error = NULL
                WHERE workspace = ?
                """,
                (now, now, deleted_by, workspace),
            )
            conn.commit()

    async def restore_workspace(self, workspace: str, restored_by: str) -> dict[str, Any]:
        await asyncio.to_thread(self._restore_workspace_sync, workspace, restored_by)
        return await self.get_workspace(workspace)

    def _restore_workspace_sync(self, workspace: str, restored_by: str) -> None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT status FROM workspaces WHERE workspace = ?",
                (workspace,),
            ).fetchone()
            if row is None:
                raise WorkspaceNotFoundError(f"Workspace '{workspace}' not found")
            if row["status"] != "soft_deleted":
                raise WorkspaceStateTransitionError(
                    f"Workspace '{workspace}' is not in soft_deleted state"
                )

            now = _utc_now()
            conn.execute(
                """
                UPDATE workspaces
                SET status = 'ready',
                    updated_at = ?,
                    deleted_at = NULL,
                    deleted_by = ?,
                    delete_error = NULL
                WHERE workspace = ?
                """,
                (now, restored_by, workspace),
            )
            conn.execute(
                """
                UPDATE workspace_operations
                SET kind = NULL,
                    state = 'idle',
                    requested_by = NULL,
                    started_at = NULL,
                    finished_at = NULL,
                    error = NULL,
                    progress_json = '{}'
                WHERE workspace = ?
                """,
                (workspace,),
            )
            conn.commit()

    async def begin_hard_delete(
        self, workspace: str, requested_by: str
    ) -> dict[str, Any]:
        await asyncio.to_thread(self._begin_hard_delete_sync, workspace, requested_by)
        return await self.get_workspace_operation(workspace)

    def _begin_hard_delete_sync(self, workspace: str, requested_by: str) -> None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT status, is_protected
                FROM workspaces
                WHERE workspace = ?
                """,
                (workspace,),
            ).fetchone()
            if row is None:
                raise WorkspaceNotFoundError(f"Workspace '{workspace}' not found")
            if row["is_protected"]:
                raise WorkspaceStateTransitionError(
                    f"Workspace '{workspace}' is protected"
                )
            if row["status"] == "hard_deleting":
                raise WorkspaceStateTransitionError(
                    f"Workspace '{workspace}' is already hard deleting"
                )
            if row["status"] not in {"ready", "delete_failed", "soft_deleted"}:
                raise WorkspaceStateTransitionError(
                    f"Workspace '{workspace}' cannot start hard delete from status '{row['status']}'"
                )

            now = _utc_now()
            conn.execute(
                """
                UPDATE workspaces
                SET status = 'hard_deleting',
                    updated_at = ?,
                    delete_error = NULL
                WHERE workspace = ?
                """,
                (now, workspace),
            )
            conn.execute(
                """
                UPDATE workspace_operations
                SET kind = 'hard_delete',
                    state = 'running',
                    requested_by = ?,
                    started_at = ?,
                    finished_at = NULL,
                    error = NULL,
                    progress_json = '{}'
                WHERE workspace = ?
                """,
                (requested_by, now, workspace),
            )
            conn.commit()

    async def get_workspace_operation(self, workspace: str) -> dict[str, Any]:
        row = await asyncio.to_thread(self._get_workspace_operation_sync, workspace)
        if row is None:
            raise WorkspaceNotFoundError(f"Workspace '{workspace}' not found")
        return {
            "workspace": workspace,
            "kind": row["kind"],
            "state": row["state"],
            "requested_by": row["requested_by"],
            "started_at": row["started_at"],
            "finished_at": row["finished_at"],
            "error": row["error"],
            "progress": json.loads(row["progress_json"] or "{}"),
        }

    async def update_hard_delete_progress(
        self, workspace: str, progress: dict[str, Any]
    ) -> dict[str, Any]:
        await asyncio.to_thread(
            self._update_hard_delete_progress_sync, workspace, progress
        )
        return await self.get_workspace_operation(workspace)

    def _update_hard_delete_progress_sync(
        self, workspace: str, progress: dict[str, Any]
    ) -> None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT workspace FROM workspaces WHERE workspace = ?",
                (workspace,),
            ).fetchone()
            if row is None:
                raise WorkspaceNotFoundError(f"Workspace '{workspace}' not found")
            conn.execute(
                """
                UPDATE workspace_operations
                SET progress_json = ?
                WHERE workspace = ?
                """,
                (json.dumps(progress), workspace),
            )
            conn.commit()

    async def fail_hard_delete(self, workspace: str, error: str) -> dict[str, Any]:
        await asyncio.to_thread(self._fail_hard_delete_sync, workspace, error)
        return await self.get_workspace(workspace)

    def _fail_hard_delete_sync(self, workspace: str, error: str) -> None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT workspace FROM workspaces WHERE workspace = ?",
                (workspace,),
            ).fetchone()
            if row is None:
                raise WorkspaceNotFoundError(f"Workspace '{workspace}' not found")
            now = _utc_now()
            conn.execute(
                """
                UPDATE workspaces
                SET status = 'delete_failed',
                    updated_at = ?,
                    delete_error = ?
                WHERE workspace = ?
                """,
                (now, error, workspace),
            )
            conn.execute(
                """
                UPDATE workspace_operations
                SET state = 'failed',
                    finished_at = ?,
                    error = ?
                WHERE workspace = ?
                """,
                (now, error, workspace),
            )
            conn.commit()

    async def complete_hard_delete(self, workspace: str) -> dict[str, Any]:
        await asyncio.to_thread(self._complete_hard_delete_sync, workspace)
        return await self.get_workspace(workspace)

    def _complete_hard_delete_sync(self, workspace: str) -> None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT workspace FROM workspaces WHERE workspace = ?",
                (workspace,),
            ).fetchone()
            if row is None:
                raise WorkspaceNotFoundError(f"Workspace '{workspace}' not found")
            now = _utc_now()
            conn.execute(
                """
                UPDATE workspaces
                SET status = 'hard_deleted',
                    updated_at = ?,
                    deleted_at = COALESCE(deleted_at, ?)
                WHERE workspace = ?
                """,
                (now, now, workspace),
            )
            conn.execute(
                """
                UPDATE workspace_operations
                SET state = 'completed',
                    finished_at = ?,
                    error = NULL
                WHERE workspace = ?
                """,
                (now, workspace),
            )
            conn.commit()

    def _get_workspace_operation_sync(self, workspace: str) -> sqlite3.Row | None:
        with self._connect() as conn:
            return conn.execute(
                """
                SELECT op.*
                FROM workspace_operations op
                JOIN workspaces ws ON ws.workspace = op.workspace
                WHERE ws.workspace = ?
                """,
                (workspace,),
            ).fetchone()

    def _create_workspace_sync(
        self,
        workspace: str,
        display_name: str,
        description: str,
        created_by: str,
        visibility: str,
    ) -> None:
        now = _utc_now()
        owners = [created_by] if created_by else []

        with self._connect() as conn:
            existing = conn.execute(
                "SELECT workspace FROM workspaces WHERE workspace = ?",
                (workspace,),
            ).fetchone()
            if existing is not None:
                raise WorkspaceAlreadyExistsError(
                    f"Workspace '{workspace}' already exists"
                )

            conn.execute(
                """
                INSERT INTO workspaces (
                    workspace,
                    display_name,
                    description,
                    status,
                    visibility,
                    created_by,
                    owners_json,
                    is_default,
                    is_protected,
                    created_at,
                    updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
                """,
                (
                    workspace,
                    display_name,
                    description,
                    "ready",
                    visibility,
                    created_by,
                    json.dumps(owners),
                    now,
                    now,
                ),
            )
            conn.execute(
                """
                INSERT INTO workspace_operations (
                    workspace,
                    kind,
                    state,
                    requested_by,
                    started_at,
                    finished_at,
                    error,
                    progress_json
                ) VALUES (?, NULL, 'idle', NULL, NULL, NULL, NULL, '{}')
                """,
                (workspace,),
            )
            conn.commit()

    def _row_to_record(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "workspace": row["workspace"],
            "display_name": row["display_name"],
            "description": row["description"],
            "status": row["status"],
            "visibility": row["visibility"],
            "created_by": row["created_by"],
            "owners": json.loads(row["owners_json"] or "[]"),
            "is_default": bool(row["is_default"]),
            "is_protected": bool(row["is_protected"]),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "deleted_at": row["deleted_at"],
            "deleted_by": row["deleted_by"],
            "delete_error": row["delete_error"],
        }
