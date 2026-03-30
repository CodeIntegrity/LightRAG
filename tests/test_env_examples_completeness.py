"""Regression checks for env.example and env.zh.example coverage."""

from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

from lightrag.kg import STORAGE_ENV_REQUIREMENTS, STORAGES
from lightrag.llm.binding_options import BindingOptions

pytestmark = pytest.mark.offline

REPO_ROOT = Path(__file__).resolve().parents[1]
ENV_VAR_PATTERN = re.compile(r"^\s*#?\s*#?\s*([A-Z][A-Z0-9_]*)=", re.M)
INTERNAL_SENTINELS = {
    "LIGHTRAG_GUNICORN_MODE",
    "LIGHTRAG_MAIN_PROCESS",
}


def _parse_env_template(path: Path) -> set[str]:
    return set(ENV_VAR_PATTERN.findall(path.read_text(encoding="utf-8")))


class _EnvVisitor(ast.NodeVisitor):
    def __init__(self) -> None:
        self.names: set[str] = set()

    def visit_Call(self, node: ast.Call) -> None:
        fn = node.func
        should_capture = False

        if isinstance(fn, ast.Name) and fn.id == "get_env_value":
            should_capture = True
        elif (
            isinstance(fn, ast.Attribute)
            and isinstance(fn.value, ast.Name)
            and fn.value.id == "os"
            and fn.attr == "getenv"
        ):
            should_capture = True
        elif (
            isinstance(fn, ast.Attribute)
            and isinstance(fn.value, ast.Attribute)
            and isinstance(fn.value.value, ast.Name)
            and fn.value.value.id == "os"
            and fn.value.attr == "environ"
            and fn.attr == "get"
        ):
            should_capture = True

        if (
            should_capture
            and node.args
            and isinstance(node.args[0], ast.Constant)
            and isinstance(node.args[0].value, str)
        ):
            self.names.add(node.args[0].value)

        self.generic_visit(node)

    def visit_Subscript(self, node: ast.Subscript) -> None:
        if (
            isinstance(node.value, ast.Attribute)
            and isinstance(node.value.value, ast.Name)
            and node.value.value.id == "os"
            and node.value.attr == "environ"
            and isinstance(node.slice, ast.Constant)
            and isinstance(node.slice.value, str)
        ):
            self.names.add(node.slice.value)

        self.generic_visit(node)


def _runtime_env_vars() -> set[str]:
    names: set[str] = set()

    for path in (REPO_ROOT / "lightrag").rglob("*.py"):
        # binding_options.py exposes user-facing env vars via BindingOptions introspection
        # while its __main__ self-test also contains stale env names we do not want here.
        if path.name == "binding_options.py":
            continue

        tree = ast.parse(path.read_text(encoding="utf-8"))
        visitor = _EnvVisitor()
        visitor.visit(tree)
        names.update(visitor.names)

    return names


def _binding_env_vars() -> set[str]:
    names: set[str] = set()
    for cls in BindingOptions.__subclasses__():
        for item in cls.args_env_name_type_value():
            names.add(item["env_name"])
    return names


def _storage_env_vars() -> set[str]:
    names: set[str] = set()
    kg_dir = REPO_ROOT / "lightrag" / "kg"

    for storage_name, required_vars in STORAGE_ENV_REQUIREMENTS.items():
        module_ref = STORAGES.get(storage_name)
        if not module_ref:
            continue

        module_name = module_ref.rsplit(".", 1)[-1]
        module_path = kg_dir / f"{module_name}.py"
        if not module_path.exists():
            continue

        names.update(required_vars)

    return names


def _expected_env_vars() -> set[str]:
    return (_runtime_env_vars() | _binding_env_vars() | _storage_env_vars()) - INTERNAL_SENTINELS


def test_env_examples_define_same_variable_set() -> None:
    env_en = _parse_env_template(REPO_ROOT / "env.example")
    env_zh = _parse_env_template(REPO_ROOT / "env.zh.example")

    assert env_en == env_zh


def test_env_example_covers_runtime_and_binding_variables() -> None:
    env_en = _parse_env_template(REPO_ROOT / "env.example")
    missing = sorted(_expected_env_vars() - env_en)

    assert missing == []
