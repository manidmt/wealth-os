import json
import pandas as pd
from typing import Optional, Dict, Any


def get_month_spend(df_movements_recent, month=None):
    if month is None:
        month = df_movements_recent["date"].max().strftime("%Y-%m")
    month_expenses = df_movements_recent[
        (df_movements_recent["type"] == "expense") &
        (df_movements_recent["date"].dt.strftime("%Y-%m") == month)
    ]
    if len(month_expenses) == 0:
        return {"error": f"No hay gastos para {month}"}
    total_spend = month_expenses["amount"].sum()
    return {
        "month": month,
        "totalSpend": round(total_spend, 2),
        "currency": "EUR",
        "transactionCount": len(month_expenses),
        "avgTransaction": round(total_spend / len(month_expenses), 2),
        "largestTransaction": round(month_expenses["amount"].max(), 2),
        "largestCategory": month_expenses.groupby("category")["amount"].sum().idxmax(),
        "largestCategoryAmount": round(month_expenses.groupby("category")["amount"].sum().max(), 2),
    }


def get_top_categories(df_movements_recent, month=None, limit=5):
    if month is None:
        month = df_movements_recent["date"].max().strftime("%Y-%m")
    month_expenses = df_movements_recent[
        (df_movements_recent["type"] == "expense") &
        (df_movements_recent["date"].dt.strftime("%Y-%m") == month)
    ]
    if len(month_expenses) == 0:
        return {"error": f"No hay gastos para {month}"}
    category_spend = (
        month_expenses.groupby("category")
        .agg(amount=("amount", "sum"), transactions=("amount", "count"))
        .reset_index()
        .sort_values("amount", ascending=False)
        .head(limit)
    )
    total_spend = month_expenses["amount"].sum()
    return {
        "month": month,
        "categories": [
            {
                "name": row["category"],
                "amount": round(row["amount"], 2),
                "percent": round((row["amount"] / total_spend) * 100, 1),
                "transactions": int(row["transactions"]),
            }
            for _, row in category_spend.iterrows()
        ],
        "totalSpend": round(total_spend, 2),
        "currency": "EUR",
    }


def get_month_comparison(df_movements_recent, current_month=None, previous_month=None):
    if current_month is None:
        current_month = df_movements_recent["date"].max().strftime("%Y-%m")
    if previous_month is None:
        previous_month = (pd.to_datetime(current_month) - pd.DateOffset(months=1)).strftime("%Y-%m")

    def get_exp(month):
        return df_movements_recent[
            (df_movements_recent["type"] == "expense") &
            (df_movements_recent["date"].dt.strftime("%Y-%m") == month)
        ]

    curr = get_exp(current_month)
    prev = get_exp(previous_month)
    if len(curr) == 0:
        return {"error": f"No hay gastos para {current_month}"}
    if len(prev) == 0:
        return {"error": f"No hay gastos para {previous_month}"}

    curr_total = curr["amount"].sum()
    prev_total = prev["amount"].sum()
    diff = curr_total - prev_total
    return {
        "currentMonth": current_month,
        "previousMonth": previous_month,
        "currentSpend": round(curr_total, 2),
        "previousSpend": round(prev_total, 2),
        "difference": round(diff, 2),
        "differencePercent": round((diff / prev_total) * 100, 1),
        "trend": "up" if diff > 0 else "down",
        "currency": "EUR",
    }


def _fx_to_eur(df):
    # Cada posición guarda su precio en su divisa nativa; fx_to_eur la convierte
    # a EUR (lo escribe el botón de precios). Ausente/NaN → 1 (EUR).
    if "fx_to_eur" in df.columns:
        return pd.to_numeric(df["fx_to_eur"], errors="coerce").fillna(1)
    return 1


def get_net_worth_summary(df_movements_recent, df_portfolio):
    df = df_portfolio.copy()
    fx = _fx_to_eur(df)
    df["current_value"] = df["quantity"] * df["current_price"] * fx
    df["cost_value"] = df["quantity"] * df["avg_cost"] * fx
    df["gain_loss"] = df["current_value"] - df["cost_value"]
    portfolio_value = df["current_value"].sum()
    portfolio_cost = df["cost_value"].sum()
    portfolio_gain = df["gain_loss"].sum()
    total_income = df_movements_recent[df_movements_recent["type"] == "income"]["amount"].sum()
    total_expenses = df_movements_recent[df_movements_recent["type"] == "expense"]["amount"].sum()
    net_savings = total_income - total_expenses
    return {
        "portfolioValue": round(portfolio_value, 2),
        "portfolioCost": round(portfolio_cost, 2),
        "portfolioGainLoss": round(portfolio_gain, 2),
        "portfolioGainLossPct": round((portfolio_gain / portfolio_cost) * 100, 2),
        "netSavingsPeriod": round(net_savings, 2),
        "totalNetWorth": round(portfolio_value + net_savings, 2),
        "currency": "EUR",
    }


def get_portfolio_summary(df_portfolio):
    df = df_portfolio.copy()
    fx = _fx_to_eur(df)
    df["current_value"] = df["quantity"] * df["current_price"] * fx
    df["cost_value"] = df["quantity"] * df["avg_cost"] * fx
    df["gain_loss"] = df["current_value"] - df["cost_value"]
    df["gain_loss_pct"] = (df["gain_loss"] / df["cost_value"]) * 100
    total_value = df["current_value"].sum()
    return {
        "positions": [
            {
                "name": row["asset_name"],
                "ticker": row["ticker"],
                "currentValue": round(row["current_value"], 2),
                "gainLoss": round(row["gain_loss"], 2),
                "gainLossPct": round(row["gain_loss_pct"], 1),
                "weight": round((row["current_value"] / total_value) * 100, 1),
            }
            for _, row in df.sort_values("current_value", ascending=False).iterrows()
        ],
        "totalValue": round(total_value, 2),
        "totalGainLoss": round(df["gain_loss"].sum(), 2),
        "totalGainLossPct": round((df["gain_loss"].sum() / df["cost_value"].sum()) * 100, 2),
        "currency": "EUR",
    }


def get_category_trend(df_movements_recent, category, months=3):
    expenses = df_movements_recent[df_movements_recent["type"] == "expense"].copy()
    expenses["month"] = expenses["date"].dt.strftime("%Y-%m")
    cat_exp = expenses[expenses["category"].str.lower() == category.lower()]
    if len(cat_exp) == 0:
        return {"error": f"Categoría '{category}' no encontrada", "available": expenses["category"].unique().tolist()}
    all_months = sorted(expenses["month"].unique())[-months:]
    trend = [
        {"month": m, "amount": round(cat_exp[cat_exp["month"] == m]["amount"].sum(), 2), "transactions": len(cat_exp[cat_exp["month"] == m])}
        for m in all_months
    ]
    amounts = [t["amount"] for t in trend]
    return {"category": category, "trend": trend, "average": round(sum(amounts) / len(amounts), 2), "currency": "EUR"}


def get_live_savings_summary(df_movements_recent, month=None):
    if month is None:
        month = df_movements_recent["date"].max().strftime("%Y-%m")
    month_data = df_movements_recent[df_movements_recent["date"].dt.strftime("%Y-%m") == month]
    if len(month_data) == 0:
        return {"error": f"No hay datos para {month}"}
    income = month_data[month_data["type"] == "income"]["amount"].sum()
    expenses = month_data[month_data["type"] == "expense"]["amount"].sum()
    savings = income - expenses
    return {
        "month": month,
        "income": round(income, 2),
        "expenses": round(expenses, 2),
        "savings": round(savings, 2),
        "savingsRate": round((savings / income * 100) if income > 0 else 0, 1),
        "currency": "EUR",
    }


TOOLS_SCHEMA = [
    {"type": "function", "function": {"name": "get_month_spend", "description": "Gasto total de un mes con desglose.", "parameters": {"type": "object", "properties": {"month": {"type": "string"}}, "required": []}}},
    {"type": "function", "function": {"name": "get_top_categories", "description": "Top categorías por gasto en un mes.", "parameters": {"type": "object", "properties": {"month": {"type": "string"}, "limit": {"type": "integer"}}, "required": []}}},
    {"type": "function", "function": {"name": "get_month_comparison", "description": "Compara gasto entre dos meses.", "parameters": {"type": "object", "properties": {"current_month": {"type": "string"}, "previous_month": {"type": "string"}}, "required": []}}},
    {"type": "function", "function": {"name": "get_net_worth_summary", "description": "Patrimonio neto total.", "parameters": {"type": "object", "properties": {}, "required": []}}},
    {"type": "function", "function": {"name": "get_portfolio_summary", "description": "Desglose detallado del portfolio.", "parameters": {"type": "object", "properties": {}, "required": []}}},
    {"type": "function", "function": {"name": "get_category_trend", "description": "Evolución del gasto de una categoría en N meses.", "parameters": {"type": "object", "properties": {"category": {"type": "string"}, "months": {"type": "integer"}}, "required": ["category"]}}},
    {"type": "function", "function": {"name": "get_live_savings_summary", "description": "Resumen de ahorro: ingresos, gastos y tasa de ahorro.", "parameters": {"type": "object", "properties": {"month": {"type": "string"}}, "required": []}}},
]


def dispatch_tool(tool_name, tool_args, df_movements_recent, df_portfolio):
    tool_map = {
        "get_month_spend": lambda: get_month_spend(df_movements_recent, **tool_args),
        "get_top_categories": lambda: get_top_categories(df_movements_recent, **tool_args),
        "get_month_comparison": lambda: get_month_comparison(df_movements_recent, **tool_args),
        "get_net_worth_summary": lambda: get_net_worth_summary(df_movements_recent, df_portfolio),
        "get_portfolio_summary": lambda: get_portfolio_summary(df_portfolio),
        "get_category_trend": lambda: get_category_trend(df_movements_recent, **tool_args),
        "get_live_savings_summary": lambda: get_live_savings_summary(df_movements_recent, **tool_args),
    }
    if tool_name not in tool_map:
        return json.dumps({"error": f"Tool '{tool_name}' no existe"})
    return json.dumps(tool_map[tool_name](), ensure_ascii=False)