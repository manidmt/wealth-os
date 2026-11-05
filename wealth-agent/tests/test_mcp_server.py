import json
import stat

import pandas as pd
import pytest

from app import mcp_server


@pytest.fixture
def frames():
    movements = pd.DataFrame(
        [
            {"date": "2026-06-01", "type": "expense", "category": "Comida", "amount": 100.0,
             "description": "SUPER", "currency": "EUR"},
            {"date": "2026-06-10", "type": "income", "category": "Nómina", "amount": 2000.0,
             "description": "NOMINA", "currency": "EUR"},
        ]
    ).assign(date=lambda d: pd.to_datetime(d["date"]))
    portfolio = pd.DataFrame(
        [{"asset_name": "MSCI World", "ticker": "IWDA", "quantity": 10.0,
          "current_price": 100.0, "avg_cost": 80.0}]
    )
    return movements, portfolio


@pytest.fixture
def server(monkeypatch, tmp_path, frames):
    movements, portfolio = frames
    calls = []

    def loader():
        calls.append(1)
        return movements, portfolio

    monkeypatch.setattr(mcp_server, "_load_frames", loader)
    monkeypatch.setattr(mcp_server, "AUDIT_PATH", tmp_path / "state" / "audit.log")
    mcp_server.reset_cache()
    yield type("Fixture", (), {"loader_calls": calls, "audit": tmp_path / "state" / "audit.log"})
    mcp_server.reset_cache()


# --- Caché -------------------------------------------------------------------------


def test_loads_the_data_once_within_the_ttl(server):
    mcp_server.get_frames(now=lambda: 0.0)
    mcp_server.get_frames(now=lambda: mcp_server.CACHE_TTL_SECONDS - 1)

    assert len(server.loader_calls) == 1


def test_reloads_the_data_after_the_ttl(server):
    mcp_server.get_frames(now=lambda: 0.0)
    mcp_server.get_frames(now=lambda: mcp_server.CACHE_TTL_SECONDS + 1)

    assert len(server.loader_calls) == 2


def test_recent_frame_keeps_the_last_180_days(server):
    _, recent, _ = mcp_server.get_frames(now=lambda: 0.0)

    assert len(recent) == 2


def test_recent_frame_drops_older_movements(monkeypatch, server):
    old = pd.DataFrame(
        [
            {"date": "2025-01-01", "type": "expense", "category": "Viejo", "amount": 5.0,
             "description": "", "currency": "EUR"},
            {"date": "2026-06-01", "type": "expense", "category": "Comida", "amount": 10.0,
             "description": "", "currency": "EUR"},
        ]
    ).assign(date=lambda d: pd.to_datetime(d["date"]))
    monkeypatch.setattr(mcp_server, "_load_frames", lambda: (old, pd.DataFrame()))
    mcp_server.reset_cache()

    full, recent, _ = mcp_server.get_frames(now=lambda: 0.0)

    assert len(full) == 2
    assert list(recent["category"]) == ["Comida"]


# --- Auditoría ---------------------------------------------------------------------


def test_audit_writes_one_json_line_per_call(server):
    mcp_server.audit("get_month_spend", {"month": "2026-06"}, rows=1)
    mcp_server.audit("get_portfolio_summary", {}, rows=3)

    lines = server.audit.read_text().strip().splitlines()
    assert len(lines) == 2
    first = json.loads(lines[0])
    assert first["tool"] == "get_month_spend"
    assert first["args"] == {"month": "2026-06"}
    assert first["rows"] == 1
    assert "timestamp" in first


def test_audit_file_is_not_readable_by_other_users(server):
    mcp_server.audit("get_month_spend", {}, rows=1)

    assert stat.S_IMODE(server.audit.stat().st_mode) & 0o077 == 0


def test_audit_does_not_record_amounts_or_descriptions(server):
    mcp_server.audit("list_movements", {"start_date": "2026-06-01", "limit": 50}, rows=2)

    logged = json.loads(server.audit.read_text().strip())
    assert logged["args"] == {"start_date": "2026-06-01", "limit": 50}
    assert "SUPER" not in server.audit.read_text()


def test_audit_never_breaks_a_tool_call(monkeypatch, server):
    monkeypatch.setattr(mcp_server, "AUDIT_PATH", server.audit.parent / "no-se-puede" / "x" / "audit.log")
    monkeypatch.setattr(mcp_server.Path, "mkdir", lambda *a, **k: (_ for _ in ()).throw(OSError("disco lleno")))

    mcp_server.audit("get_month_spend", {}, rows=1)  # no debe lanzar


# --- Herramientas ------------------------------------------------------------------


def test_month_spend_matches_the_underlying_function(server):
    result = mcp_server.get_month_spend("2026-06")

    assert result["totalSpend"] == 100.0
    assert result["transactionCount"] == 1


def test_list_movements_applies_the_sanitizer_and_the_whitelist(server):
    result = mcp_server.list_movements("2026-06-01", "2026-06-30")

    assert set(result["movements"][0]) == {
        "date", "amount", "currency", "type", "category", "description_untrusted"
    }


def test_net_worth_uses_the_recent_window(server):
    result = mcp_server.get_net_worth_summary()

    assert result["portfolioValue"] == 1000.0
    assert result["netSavingsPeriod"] == 1900.0


def test_category_trend_uses_the_full_history(monkeypatch, server):
    long_history = pd.DataFrame(
        [{"date": f"2026-{month:02d}-01", "type": "expense", "category": "Comida", "amount": 10.0,
          "description": "", "currency": "EUR"} for month in range(1, 9)]
    ).assign(date=lambda d: pd.to_datetime(d["date"]))
    monkeypatch.setattr(mcp_server, "_load_frames", lambda: (long_history, pd.DataFrame()))
    mcp_server.reset_cache()

    result = mcp_server.get_category_trend("Comida", months=8)

    assert len(result["trend"]) == 8


def test_every_tool_call_is_audited(server):
    mcp_server.get_month_spend("2026-06")
    mcp_server.list_movements("2026-06-01", "2026-06-30")

    tools = [json.loads(line)["tool"] for line in server.audit.read_text().strip().splitlines()]
    assert tools == ["get_month_spend", "list_movements"]


def test_tools_report_errors_instead_of_crashing(monkeypatch, server):
    monkeypatch.setattr(mcp_server, "_load_frames", lambda: (_ for _ in ()).throw(RuntimeError("supabase caído")))
    mcp_server.reset_cache()

    result = mcp_server.get_month_spend()

    assert "error" in result
    assert "supabase caído" in result["error"]


def test_every_registered_tool_is_marked_read_only():
    annotations = [tool.annotations for tool in mcp_server.server._tool_manager.list_tools()]

    assert annotations and all(a is not None and a.read_only_hint for a in annotations)


def test_registers_the_eight_expected_tools():
    names = {tool.name for tool in mcp_server.server._tool_manager.list_tools()}

    assert names == {
        "get_month_spend",
        "get_top_categories",
        "get_month_comparison",
        "get_category_trend",
        "get_savings_summary",
        "get_net_worth_summary",
        "get_portfolio_summary",
        "list_movements",
    }
