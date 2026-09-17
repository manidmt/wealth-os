import json

import pandas as pd

from app.tools.financial_tools import dispatch_tool


def _movements():
    return pd.DataFrame(
        [
            {"date": "2026-06-01", "type": "expense", "category": "Comida", "amount": 100.0},
            {"date": "2026-06-05", "type": "expense", "category": "Ocio", "amount": 50.0},
            {"date": "2026-06-10", "type": "income", "category": "Nómina", "amount": 2000.0},
        ]
    ).assign(date=lambda d: pd.to_datetime(d["date"]))


def _empty_portfolio():
    return pd.DataFrame(columns=["asset_name", "ticker", "quantity", "current_price", "avg_cost"])


def test_dispatch_tool_routes_to_get_month_spend():
    result = json.loads(dispatch_tool("get_month_spend", {}, _movements(), _empty_portfolio()))

    assert result["month"] == "2026-06"
    assert result["totalSpend"] == 150.0
    assert result["transactionCount"] == 2


def test_dispatch_tool_forwards_args_to_get_top_categories():
    result = json.loads(
        dispatch_tool("get_top_categories", {"limit": 1}, _movements(), _empty_portfolio())
    )

    assert len(result["categories"]) == 1
    assert result["categories"][0]["name"] == "Comida"


def test_dispatch_tool_unknown_tool_returns_error():
    result = json.loads(dispatch_tool("does_not_exist", {}, _movements(), _empty_portfolio()))

    assert "error" in result
