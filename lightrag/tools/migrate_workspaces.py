from __future__ import annotations

import argparse
import asyncio
import os
from pathlib import Path

from lightrag.api.workspace_registry import (
    WorkspaceAlreadyExistsError,
    WorkspaceRegistryStore,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Import legacy workspaces into the managed workspace registry."
    )
    parser.add_argument("--registry-path", required=True)
    parser.add_argument("--working-dir", default=os.getenv("WORKING_DIR", "./rag_storage"))
    parser.add_argument("--input-dir", default=os.getenv("INPUT_DIR", "./inputs"))
    parser.add_argument("--default-workspace", default=os.getenv("WORKSPACE", ""))
    parser.add_argument("--workspace", action="append", default=[])
    parser.add_argument("--from-file")
    parser.add_argument("--discover-local", action="store_true")
    parser.add_argument("--owner", default="system")
    parser.add_argument("--visibility", choices=["public", "private"], default="public")
    parser.add_argument("--on-conflict", choices=["error", "skip"], default="error")
    parser.add_argument("--dry-run", action="store_true")
    return parser


def _read_workspace_file(path: str | None) -> list[str]:
    if not path:
        return []
    content = Path(path).read_text(encoding="utf-8")
    return [line.strip() for line in content.splitlines() if line.strip()]


def _discover_local_candidates(working_dir: Path, input_dir: Path) -> dict[str, set[str]]:
    discovered: dict[str, set[str]] = {}

    if input_dir.exists():
        for child in input_dir.iterdir():
            if child.is_dir():
                discovered.setdefault(child.name, set()).add("input_dir")

    if working_dir.exists():
        for child in working_dir.iterdir():
            if child.is_dir() and (child / "prompt_versions").exists():
                discovered.setdefault(child.name, set()).add("prompt_versions")

    return discovered


async def _run(args: argparse.Namespace) -> int:
    registry_path = Path(args.registry_path)
    working_dir = Path(args.working_dir)
    input_dir = Path(args.input_dir)

    store = WorkspaceRegistryStore(registry_path)
    await store.initialize(default_workspace=args.default_workspace)

    discovered = (
        _discover_local_candidates(working_dir=working_dir, input_dir=input_dir)
        if args.discover_local
        else {}
    )

    explicit = list(args.workspace) + _read_workspace_file(args.from_file)
    ordered_candidates: list[str] = []
    seen: set[str] = set()
    for workspace in explicit + list(discovered.keys()):
        if workspace and workspace not in seen:
            seen.add(workspace)
            ordered_candidates.append(workspace)

    if not ordered_candidates:
        print("No workspace candidates found.")
        return 0

    existing_records = await store.list_workspaces()
    existing = {record["workspace"] for record in existing_records}

    print("Workspace migration candidates:")
    for workspace in ordered_candidates:
        sources = sorted(discovered.get(workspace, set()))
        source_text = f" ({', '.join(sources)})" if sources else ""
        if sources and len(sources) == 1:
            source_text += " [warning: local completeness not verified]"
        print(f"- {workspace}{source_text}")

    if args.dry_run:
        print("Dry run only. No changes were made.")
        return 0

    imported: list[str] = []
    conflicts: list[str] = []

    for workspace in ordered_candidates:
        if workspace in existing:
            conflicts.append(workspace)
            if args.on_conflict == "skip":
                print(f"Skipping existing workspace: {workspace}")
                continue
            print(f"Conflict: workspace already registered: {workspace}")
            return 1

        try:
            await store.create_workspace(
                workspace=workspace,
                display_name=workspace,
                description="Imported legacy workspace",
                created_by=args.owner,
                visibility=args.visibility,
            )
            imported.append(workspace)
            print(f"Imported workspace: {workspace}")
        except WorkspaceAlreadyExistsError:
            conflicts.append(workspace)
            if args.on_conflict == "skip":
                print(f"Skipping existing workspace: {workspace}")
                continue
            print(f"Conflict: workspace already registered: {workspace}")
            return 1

    print(f"Imported {len(imported)} workspaces.")
    if conflicts:
        print(f"Conflicts encountered: {', '.join(conflicts)}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return asyncio.run(_run(args))


if __name__ == "__main__":
    raise SystemExit(main())
