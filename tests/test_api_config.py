import sys

from lightrag.api import config as api_config


def test_parse_args_defaults_workspace_registry_path_under_working_dir(
    monkeypatch, tmp_path
):
    monkeypatch.setattr(sys, "argv", [sys.argv[0]])
    monkeypatch.delenv("LIGHTRAG_WORKSPACE_REGISTRY_PATH", raising=False)
    monkeypatch.setenv("WORKING_DIR", str(tmp_path / "custom_rag_storage"))

    args = api_config.parse_args()

    assert args.workspace_registry_path == str(
        (tmp_path / "custom_rag_storage" / "workspaces" / "registry.sqlite3").resolve()
    )
