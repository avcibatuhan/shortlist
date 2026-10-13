"""Actor prices from config/prices.yaml: cost estimates and the charge cap per Actor run."""

import math
from decimal import Decimal
from functools import lru_cache
from pathlib import Path

import yaml
from pydantic import BaseModel, Field

from shortlist.config import REPO_ROOT

PRICES_FILE = REPO_ROOT / "config" / "prices.yaml"
# Headroom on the charge cap so rounding on Apify's side cannot cut off the last results.
CAP_HEADROOM = 1.2


class SourcePrice(BaseModel):
    per_1000_results: float = Field(ge=0)
    per_start: float = Field(ge=0)

    def cost_usd(self, results: int, starts: int = 1) -> float:
        return starts * self.per_start + results * self.per_1000_results / 1000

    def charge_cap_usd(self, limit: int) -> Decimal:
        """Hard limit for one Actor run, in whole cents (at least 1 cent).

        Apify needs it explicitly: with only a result limit it derives the cap from the result
        price alone, and the start fee then aborts small runs before they return anything.
        """
        cents = max(1, math.ceil(self.cost_usd(limit) * CAP_HEADROOM * 100))
        return Decimal(cents) / 100


def max_cost_usd(price: SourcePrice, limit: int, searches: int) -> float:
    """Most a source can cost in one run: every result billed and every search started once."""
    return price.cost_usd(limit, starts=searches)


def load_prices(path: Path = PRICES_FILE) -> dict[str, SourcePrice]:
    raw = yaml.safe_load(path.read_text())
    return {source: SourcePrice.model_validate(price) for source, price in raw.items()}


@lru_cache
def get_prices() -> dict[str, SourcePrice]:
    return load_prices()
