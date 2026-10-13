from decimal import Decimal

import pytest

from shortlist.prices import SourcePrice, load_prices
from shortlist.sources import SOURCES


def test_every_source_has_a_price() -> None:
    assert set(SOURCES) == set(load_prices())


def test_cost_includes_start_fee_per_search() -> None:
    price = SourcePrice(per_1000_results=1.0, per_start=0.005)

    assert price.cost_usd(results=50, starts=3) == pytest.approx(0.065)


@pytest.mark.parametrize(
    ("limit", "cap"),
    [(1, "0.01"), (5, "0.02"), (50, "0.07"), (1000, "1.21")],
)
def test_charge_cap_covers_start_fee_and_results(limit: int, cap: str) -> None:
    price = SourcePrice(per_1000_results=1.0, per_start=0.005)

    assert price.charge_cap_usd(limit) == Decimal(cap)
    assert price.charge_cap_usd(limit) >= Decimal(str(price.cost_usd(limit)))


def test_charge_cap_is_never_zero() -> None:
    assert SourcePrice(per_1000_results=0.1, per_start=0).charge_cap_usd(1) == Decimal("0.01")
