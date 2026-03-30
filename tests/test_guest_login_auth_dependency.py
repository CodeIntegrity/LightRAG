from __future__ import annotations

import sys

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient


pytestmark = pytest.mark.offline


def _build_guest_token():
    from lightrag.api.auth import auth_handler

    return auth_handler.create_token(
        "guest", role="guest", metadata={"auth_mode": "guest"}
    )


def test_combined_auth_accepts_guest_token_when_guest_login_enabled(monkeypatch):
    monkeypatch.setattr(sys, "argv", [sys.argv[0]])
    import lightrag.api.utils_api as utils_api

    original_accounts = utils_api.auth_handler.accounts.copy()
    original_enable_guest_login = getattr(
        utils_api.global_args, "enable_guest_login_entry", False
    )
    try:
        utils_api.auth_handler.accounts = {"alice": "secret"}
        monkeypatch.setattr(
            utils_api.global_args, "enable_guest_login_entry", True, raising=False
        )

        app = FastAPI()

        @app.get(
            "/secure",
            dependencies=[Depends(utils_api.get_combined_auth_dependency(None))],
        )
        async def secure_endpoint():
            return {"ok": True}

        client = TestClient(app)
        response = client.get(
            "/secure", headers={"Authorization": f"Bearer {_build_guest_token()}"}
        )

        assert response.status_code == 200
        assert response.json() == {"ok": True}
    finally:
        utils_api.auth_handler.accounts = original_accounts
        monkeypatch.setattr(
            utils_api.global_args,
            "enable_guest_login_entry",
            original_enable_guest_login,
            raising=False,
        )


def test_combined_auth_rejects_guest_token_when_guest_login_disabled(monkeypatch):
    monkeypatch.setattr(sys, "argv", [sys.argv[0]])
    import lightrag.api.utils_api as utils_api

    original_accounts = utils_api.auth_handler.accounts.copy()
    original_enable_guest_login = getattr(
        utils_api.global_args, "enable_guest_login_entry", False
    )
    try:
        utils_api.auth_handler.accounts = {"alice": "secret"}
        monkeypatch.setattr(
            utils_api.global_args, "enable_guest_login_entry", False, raising=False
        )

        app = FastAPI()

        @app.get(
            "/secure",
            dependencies=[Depends(utils_api.get_combined_auth_dependency(None))],
        )
        async def secure_endpoint():
            return {"ok": True}

        client = TestClient(app)
        response = client.get(
            "/secure", headers={"Authorization": f"Bearer {_build_guest_token()}"}
        )

        assert response.status_code == 401
        assert response.json()["detail"] == "Invalid token. Please login again."
    finally:
        utils_api.auth_handler.accounts = original_accounts
        monkeypatch.setattr(
            utils_api.global_args,
            "enable_guest_login_entry",
            original_enable_guest_login,
            raising=False,
        )
