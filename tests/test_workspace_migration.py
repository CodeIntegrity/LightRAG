from pathlib import Path
import asyncio

import pytest


pytestmark = pytest.mark.offline


def test_migrate_workspaces_dry_run_reports_candidates(tmp_path: Path, capsys):
    from lightrag.tools.migrate_workspaces import main

    working_dir = tmp_path / "rag_storage"
    input_dir = tmp_path / "inputs"
    (input_dir / "books").mkdir(parents=True)
    (working_dir / "research" / "prompt_versions").mkdir(parents=True)

    exit_code = main(
        [
            "--registry-path",
            str(tmp_path / "registry.sqlite3"),
            "--working-dir",
            str(working_dir),
            "--input-dir",
            str(input_dir),
            "--discover-local",
            "--dry-run",
        ]
    )

    output = capsys.readouterr().out
    assert exit_code == 0
    assert "books" in output
    assert "research" in output


def test_migrate_workspaces_from_file_sets_owner_and_visibility(tmp_path: Path, capsys):
    from lightrag.api.workspace_registry import WorkspaceRegistryStore
    from lightrag.tools.migrate_workspaces import main

    registry_path = tmp_path / "registry.sqlite3"
    workspaces_file = tmp_path / "workspaces.txt"
    workspaces_file.write_text("books\nnotes\n", encoding="utf-8")

    exit_code = main(
        [
            "--registry-path",
            str(registry_path),
            "--from-file",
            str(workspaces_file),
            "--owner",
            "admin",
            "--visibility",
            "private",
        ]
    )

    output = capsys.readouterr().out
    store = WorkspaceRegistryStore(registry_path)
    books = asyncio.run(store.get_workspace("books"))
    notes = asyncio.run(store.get_workspace("notes"))

    assert exit_code == 0
    assert "books" in output
    assert books["created_by"] == "admin"
    assert books["owners"] == ["admin"]
    assert books["visibility"] == "private"
    assert notes["owners"] == ["admin"]


def test_migrate_workspaces_conflict_mode_error_exits_non_zero(
    tmp_path: Path, capsys
):
    from lightrag.tools.migrate_workspaces import main

    registry_path = tmp_path / "registry.sqlite3"
    workspaces_file = tmp_path / "workspaces.txt"
    workspaces_file.write_text("books\n", encoding="utf-8")

    initial = main(
        [
            "--registry-path",
            str(registry_path),
            "--workspace",
            "books",
        ]
    )
    assert initial == 0

    exit_code = main(
        [
            "--registry-path",
            str(registry_path),
            "--from-file",
            str(workspaces_file),
            "--on-conflict",
            "error",
        ]
    )

    output = capsys.readouterr().out
    assert exit_code != 0
    assert "books" in output
    assert "conflict" in output.lower()
