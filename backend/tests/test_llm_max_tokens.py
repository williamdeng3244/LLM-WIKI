"""Regression: OpenAI-compatible endpoints that cap completion tokens below
our request must not hard-fail ingest. The plan phase surfaced
  400 invalid_request_error: "max_tokens is too large: 30000. This model
  supports at most 16384 completion tokens"
for every md import (file + url). We (a) request <=16000 now, and (b) parse
the model's stated cap and retry once."""
from __future__ import annotations

import pytest

from app.services.llm_client import _extract_max_completion_limit


class _Err400(Exception):
    status_code = 400
    def __init__(self, message):
        self.message = message
        super().__init__(message)


def test_parses_stated_completion_cap():
    e = _Err400(
        "Error code: 400 - {'error': {'message': 'max_tokens is too large: "
        "30000. This model supports at most 16384 completion tokens, whereas "
        "you provided 30000.', 'type': 'invalid_request_error', 'param': "
        "'max_tokens', 'code': 'invalid_value'}}"
    )
    assert _extract_max_completion_limit(e) == 16384


def test_ignores_unrelated_400():
    assert _extract_max_completion_limit(_Err400("bad schema for tool")) is None


def test_ignores_non_400():
    class Other(Exception):
        status_code = 500
    assert _extract_max_completion_limit(Other("max_tokens too large: 9 completion")) is None


def test_no_status_attr_still_parses_from_text():
    e = Exception("supports at most 8192 completion tokens")
    assert _extract_max_completion_limit(e) == 8192
