import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from shortlist.pipeline.fetch import delete_old_raw, save_raw, split_limit


@pytest.mark.parametrize(
    ("limit", "parts", "expected"),
    [(5, 3, [2, 2, 1]), (50, 3, [17, 17, 16]), (2, 3, [1, 1, 0]), (6, 1, [6]), (5, 0, [])],
)
def test_split_limit(limit: int, parts: int, expected: list[int]) -> None:
    assert split_limit(limit, parts) == expected
    assert sum(split_limit(limit, parts)) in (limit, 0)


def test_raw_output_is_deleted_after_14_days(tmp_path: Path) -> None:
    save_raw(tmp_path, 1, "stepstone", [{"id": 1}])
    save_raw(tmp_path, 2, "stepstone", [{"id": 2}])
    old = (datetime.now(UTC) - timedelta(days=15)).timestamp()
    os.utime(tmp_path / "1", (old, old))

    delete_old_raw(tmp_path)

    assert not (tmp_path / "1").exists()
    assert (tmp_path / "2" / "stepstone.json").is_file()
