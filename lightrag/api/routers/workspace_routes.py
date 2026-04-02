from __future__ import annotations

import inspect
from typing import Any, Awaitable, Callable, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field, field_validator

from lightrag.api.auth import auth_handler
from lightrag.api.utils_api import get_combined_auth_dependency
from lightrag.api.workspace_registry import (
    WorkspaceAlreadyExistsError,
    WorkspaceNotFoundError,
    WorkspaceRegistryError,
    WorkspaceRegistryStore,
    WorkspaceStateTransitionError,
    normalize_workspace_identifier,
    sanitize_workspace_identifier,
)


WorkspaceVisibility = Literal["public", "private"]


class WorkspaceCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workspace: str = Field(min_length=1)
    display_name: str = Field(min_length=1)
    description: str = Field(default="")
    visibility: WorkspaceVisibility = Field(default="public")

    @field_validator("workspace")
    @classmethod
    def validate_workspace(cls, value: str) -> str:
        return normalize_workspace_identifier(value)


def _normalize_workspace_response(record: dict[str, Any]) -> dict[str, Any]:
    return record


def _identity_from_request(request: Request) -> dict[str, str | None]:
    authorization = request.headers.get("Authorization", "").strip()
    if not authorization:
        return {"username": None, "role": "guest"}
    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authorization header",
        )
    token = authorization.removeprefix("Bearer ").strip()
    token_info = auth_handler.validate_token(token)
    return {
        "username": token_info.get("username"),
        "role": token_info.get("role", "user"),
    }


def _active_workspace_from_request(request: Request) -> str | None:
    workspace = request.headers.get("LIGHTRAG-WORKSPACE", "").strip()
    if not workspace:
        return None
    return sanitize_workspace_identifier(workspace) or None


def workspace_create_allowed(
    identity: dict[str, str | None], allow_guest_create: bool
) -> bool:
    if identity["role"] in {"user", "admin"} and identity["username"]:
        return True
    if (
        identity["role"] == "guest"
        and allow_guest_create
        and not bool(auth_handler.accounts)
    ):
        return True
    return False


def _can_view_workspace(
    identity: dict[str, str | None], record: dict[str, Any]
) -> bool:
    if identity["role"] == "admin":
        return True
    if record["visibility"] == "public":
        return True
    username = identity["username"]
    return bool(username and username in record.get("owners", []))


def _require_user(identity: dict[str, str | None]) -> str:
    if identity["role"] not in {"user", "admin"} or not identity["username"]:
        raise HTTPException(status_code=403, detail="Workspace mutation requires login")
    return identity["username"]


def _require_admin(identity: dict[str, str | None]) -> str:
    if identity["role"] != "admin" or not identity["username"]:
        raise HTTPException(status_code=403, detail="Admin role required")
    return identity["username"]


def _require_owner_or_admin(
    identity: dict[str, str | None], record: dict[str, Any]
) -> str:
    username = _require_user(identity)
    if identity["role"] == "admin" or username in record.get("owners", []):
        return username
    raise HTTPException(status_code=403, detail="Workspace owner or admin required")


def _map_registry_error(exc: WorkspaceRegistryError) -> HTTPException:
    if isinstance(exc, WorkspaceNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, WorkspaceAlreadyExistsError):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, WorkspaceStateTransitionError):
        return HTTPException(status_code=400, detail=str(exc))
    return HTTPException(status_code=400, detail=str(exc))


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
        if not workspace_create_allowed(identity, allow_guest_create):
            raise HTTPException(
                status_code=403,
                detail="Workspace creation is not allowed for this session",
            )
        if identity["role"] == "guest":
            return "guest"
        return identity["username"]

    @router.get("", dependencies=[Depends(combined_auth)])
    async def list_workspaces(include_deleted: bool = False, request: Request = None):
        identity = _identity_from_request(request)
        records = await registry_store.list_workspaces()
        visible: list[dict[str, Any]] = []
        for record in records:
            if not include_deleted and record["status"] != "ready":
                continue
            if _can_view_workspace(identity, record):
                visible.append(_normalize_workspace_response(record))
        return {"workspaces": visible}

    @router.post("", status_code=201, dependencies=[Depends(combined_auth)])
    async def create_workspace(payload: WorkspaceCreateRequest, request: Request):
        identity = _identity_from_request(request)
        created_by = _require_workspace_creator(identity)
        try:
            created = await registry_store.create_workspace(
                workspace=payload.workspace,
                display_name=payload.display_name,
                description=payload.description,
                created_by=created_by,
                visibility=payload.visibility,
            )
        except WorkspaceRegistryError as exc:
            raise _map_registry_error(exc) from exc
        if workspace_initializer is not None:
            await workspace_initializer(payload.workspace)
        return _normalize_workspace_response(created)

    @router.get("/{workspace}", dependencies=[Depends(combined_auth)])
    async def get_workspace(workspace: str, request: Request):
        identity = _identity_from_request(request)
        try:
            record = await registry_store.get_workspace(workspace)
        except WorkspaceRegistryError as exc:
            raise _map_registry_error(exc) from exc
        if not _can_view_workspace(identity, record):
            raise HTTPException(status_code=403, detail="Workspace access forbidden")
        return _normalize_workspace_response(record)

    @router.get("/{workspace}/stats", dependencies=[Depends(combined_auth)])
    async def get_workspace_stats(workspace: str, request: Request):
        identity = _identity_from_request(request)
        try:
            record = await registry_store.get_workspace(workspace)
        except WorkspaceRegistryError as exc:
            raise _map_registry_error(exc) from exc
        if not _can_view_workspace(identity, record):
            raise HTTPException(status_code=403, detail="Workspace access forbidden")
        if stats_provider is None:
            raise HTTPException(
                status_code=501, detail="Workspace stats are not configured"
            )

        stats = stats_provider(workspace)
        if inspect.isawaitable(stats):
            stats = await stats
        return stats

    @router.post("/{workspace}/soft-delete", dependencies=[Depends(combined_auth)])
    async def soft_delete_workspace(workspace: str, request: Request):
        identity = _identity_from_request(request)
        active_workspace = _active_workspace_from_request(request)
        try:
            record = await registry_store.get_workspace(workspace)
        except WorkspaceRegistryError as exc:
            raise _map_registry_error(exc) from exc
        actor = _require_owner_or_admin(identity, record)
        if active_workspace == workspace:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Workspace '{workspace}' is currently active; "
                    "switch to another workspace before soft delete"
                ),
            )
        try:
            updated = await registry_store.soft_delete_workspace(workspace, actor)
        except WorkspaceRegistryError as exc:
            raise _map_registry_error(exc) from exc
        return _normalize_workspace_response(updated)

    @router.post("/{workspace}/restore", dependencies=[Depends(combined_auth)])
    async def restore_workspace(workspace: str, request: Request):
        identity = _identity_from_request(request)
        try:
            record = await registry_store.get_workspace(workspace)
        except WorkspaceRegistryError as exc:
            raise _map_registry_error(exc) from exc
        actor = _require_owner_or_admin(identity, record)
        try:
            updated = await registry_store.restore_workspace(workspace, actor)
        except WorkspaceRegistryError as exc:
            raise _map_registry_error(exc) from exc
        return _normalize_workspace_response(updated)

    @router.post(
        "/{workspace}/hard-delete",
        status_code=status.HTTP_202_ACCEPTED,
        dependencies=[Depends(combined_auth)],
    )
    async def hard_delete_workspace(
        workspace: str, request: Request, background_tasks: BackgroundTasks
    ):
        identity = _identity_from_request(request)
        actor = _require_admin(identity)
        try:
            await registry_store.begin_hard_delete(workspace, actor)
            operation = await registry_store.get_workspace_operation(workspace)
        except WorkspaceRegistryError as exc:
            raise _map_registry_error(exc) from exc

        if delete_scheduler is not None:
            background_tasks.add_task(delete_scheduler, workspace, actor)

        return {
            "workspace": workspace,
            "status": "hard_deleting",
            "operation": operation,
        }

    @router.get("/{workspace}/operation", dependencies=[Depends(combined_auth)])
    async def get_workspace_operation(workspace: str, request: Request):
        identity = _identity_from_request(request)
        try:
            record = await registry_store.get_workspace(workspace)
            operation = await registry_store.get_workspace_operation(workspace)
        except WorkspaceRegistryError as exc:
            raise _map_registry_error(exc) from exc
        if not _can_view_workspace(identity, record):
            raise HTTPException(status_code=403, detail="Workspace access forbidden")
        return operation

    return router
