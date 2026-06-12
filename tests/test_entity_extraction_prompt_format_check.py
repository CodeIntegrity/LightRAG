from __future__ import annotations

import pytest

import lightrag.prompt as prompt_module


pytestmark = pytest.mark.offline


def test_default_text_examples_are_formattable():
    profile = prompt_module.get_default_entity_extraction_prompt_profile()
    # Must not raise: defaults only use the four allowed placeholders.
    prompt_module.ensure_text_examples_formattable(
        profile["entity_extraction_examples"], "default profile"
    )


def test_literal_delimiter_examples_pass():
    prompt_module.ensure_text_examples_formattable(
        ["entity<|#|>A<|#|>T<|#|>D\n<|COMPLETE|>"], "test"
    )


def test_placeholder_examples_pass():
    prompt_module.ensure_text_examples_formattable(
        [
            "entity{tuple_delimiter}A{tuple_delimiter}T{tuple_delimiter}D\n"
            "{completion_delimiter}"
        ],
        "test",
    )


@pytest.mark.parametrize(
    "bad_example",
    [
        "entity{tuple_delimiter}A{unknown_key}",  # KeyError
        "JSON-ish content { not a placeholder",  # ValueError: single '{'
        "positional {} placeholder",  # IndexError
        "{language.foo}",  # AttributeError
        "{language[foo]}",  # TypeError
    ],
)
def test_format_breaking_examples_fail_with_item_index(bad_example):
    with pytest.raises(ValueError) as excinfo:
        prompt_module.ensure_text_examples_formattable([bad_example], "src-label")
    message = str(excinfo.value)
    assert "item 0" in message
    assert "src-label" in message


def test_second_item_reported_with_its_index():
    with pytest.raises(ValueError) as excinfo:
        prompt_module.ensure_text_examples_formattable(
            ["fine example", "broken { example"], "src-label"
        )
    assert "item 1" in str(excinfo.value)


def test_validate_for_mode_rejects_format_breaking_text_example():
    profile = {
        "entity_types_guidance": "- T: t",
        "entity_extraction_examples": ["broken { example"],
        "entity_extraction_json_examples": [],
    }
    with pytest.raises(ValueError) as excinfo:
        prompt_module.validate_entity_extraction_prompt_profile_for_mode(
            profile, use_json=False, prompt_file_name="x.yml"
        )
    assert "x.yml" in str(excinfo.value)


def test_validate_for_mode_skips_text_check_in_json_mode():
    profile = {
        "entity_types_guidance": "- T: t",
        "entity_extraction_examples": ["broken { example"],
        "entity_extraction_json_examples": [
            '{"entities": [], "relationships": []}'
        ],
    }
    result = prompt_module.validate_entity_extraction_prompt_profile_for_mode(
        profile, use_json=True, prompt_file_name="x.yml"
    )
    assert result["entity_extraction_json_examples"]
