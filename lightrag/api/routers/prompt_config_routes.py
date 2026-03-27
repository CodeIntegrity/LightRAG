from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from lightrag.prompt_version_store import PromptVersionStore

INDEXING_ACTIVATION_WARNING = (
    "Activating a new indexing configuration only affects future indexing work and may "
    "create mixed-schema graph data unless the workspace is rebuilt."
)

PromptConfigGroup = Literal["indexing", "retrieval"]


class PromptVersionCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version_name: str = Field(min_length=1)
    comment: str = Field(default="")
    payload: dict[str, Any] = Field(default_factory=dict)
    source_version_id: str | None = Field(default=None)


class PromptVersionUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version_name: str = Field(min_length=1)
    comment: str = Field(default="")
    payload: dict[str, Any] = Field(default_factory=dict)


def create_prompt_config_routes(
    rag, api_key: str | None = None, workspace_resolver=None
) -> APIRouter:
    router = APIRouter(prefix="/prompt-config", tags=["prompt-config"])

    def _store(request: Request | None = None):
        if workspace_resolver is None or request is None:
            if not hasattr(rag, "prompt_version_store"):
                raise HTTPException(
                    status_code=500, detail="Prompt version store is not available"
                )
            return rag.prompt_version_store

        workspace = workspace_resolver(request)
        return PromptVersionStore(rag.working_dir, workspace=workspace)

    def _validate_group_type(group_type: str) -> PromptConfigGroup:
        if group_type not in {"indexing", "retrieval"}:
            raise HTTPException(status_code=404, detail="Unknown prompt config group")
        return group_type  # type: ignore[return-value]

    def _rethrow_prompt_version_error(exc: ValueError) -> None:
        status_code = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc

    @router.post("/initialize")
    async def initialize_prompt_config(
        request: Request, locale: str = "zh"
    ) -> dict[str, Any]:
        return _store(request).initialize(locale=locale)

    @router.get("/groups")
    async def list_groups(request: Request) -> dict[str, Any]:
        store = _store(request)
        return {
            "indexing": store.list_versions("indexing"),
            "retrieval": store.list_versions("retrieval"),
        }

    @router.get("/{group_type}/versions")
    async def list_versions(request: Request, group_type: str) -> dict[str, Any]:
        validated_group = _validate_group_type(group_type)
        return _store(request).list_versions(validated_group)

    @router.get("/{group_type}/versions/{version_id}")
    async def get_version(
        request: Request, group_type: str, version_id: str
    ) -> dict[str, Any]:
        validated_group = _validate_group_type(group_type)
        try:
            return _store(request).get_version(validated_group, version_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.post("/{group_type}/versions")
    async def create_version(
        request: Request, group_type: str, payload: PromptVersionCreateRequest
    ) -> dict[str, Any]:
        validated_group = _validate_group_type(group_type)
        try:
            return _store(request).create_version(
                validated_group,
                payload.payload,
                payload.version_name,
                payload.comment,
                payload.source_version_id,
            )
        except ValueError as exc:
            _rethrow_prompt_version_error(exc)

    @router.patch("/{group_type}/versions/{version_id}")
    async def update_version(
        request: Request,
        group_type: str,
        version_id: str,
        payload: PromptVersionUpdateRequest,
    ) -> dict[str, Any]:
        validated_group = _validate_group_type(group_type)
        try:
            return _store(request).update_version(
                validated_group,
                version_id,
                payload.payload,
                payload.version_name,
                payload.comment,
            )
        except ValueError as exc:
            _rethrow_prompt_version_error(exc)

    @router.post("/{group_type}/versions/{version_id}/activate")
    async def activate_version(
        request: Request, group_type: str, version_id: str
    ) -> dict[str, Any]:
        validated_group = _validate_group_type(group_type)
        try:
            active_version = _store(request).activate_version(
                validated_group, version_id
            )
        except ValueError as exc:
            _rethrow_prompt_version_error(exc)

        return {
            "group_type": validated_group,
            "active_version_id": version_id,
            "active_version": active_version,
            "warning": (
                INDEXING_ACTIVATION_WARNING if validated_group == "indexing" else None
            ),
        }

    @router.delete("/{group_type}/versions/{version_id}")
    async def delete_version(
        request: Request, group_type: str, version_id: str
    ) -> dict[str, Any]:
        validated_group = _validate_group_type(group_type)
        try:
            _store(request).delete_version(validated_group, version_id)
        except ValueError as exc:
            _rethrow_prompt_version_error(exc)
        return {"status": "success", "version_id": version_id}

    @router.get("/{group_type}/versions/{version_id}/diff")
    async def diff_version(
        request: Request,
        group_type: str,
        version_id: str,
        base_version_id: str | None = None,
    ) -> dict[str, Any]:
        validated_group = _validate_group_type(group_type)
        try:
            return _store(request).diff_versions(
                validated_group, version_id, base_version_id
            )
        except ValueError as exc:
            _rethrow_prompt_version_error(exc)

    return router
