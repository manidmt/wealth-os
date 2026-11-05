import pandas as pd

from app.tools.movement_tools import (
    MAX_LIMIT,
    MAX_RANGE_DAYS,
    list_movements,
    sanitize_description,
)


def _movements(rows):
    return pd.DataFrame(rows).assign(date=lambda d: pd.to_datetime(d["date"]))


def _row(date, amount, category="Comida", type_="expense", description="compra", currency="EUR"):
    return {
        "id": "ffffffff-ffff-ffff-ffff-ffffffffffff",
        "user_id": "00000000-0000-0000-0000-000000000001",
        "created_at": "2026-01-01T00:00:00Z",
        "date": date,
        "amount": amount,
        "category": category,
        "type": type_,
        "description": description,
        "currency": currency,
    }


# --- Saneado del concepto bancario -------------------------------------------------


def test_sanitize_collapses_whitespace_and_newlines():
    assert sanitize_description("  PAGO   TARJETA\n\n  SUPER ") == "PAGO TARJETA SUPER"


def test_sanitize_handles_missing_description():
    assert sanitize_description(None) == ""
    assert sanitize_description(float("nan")) == ""


def test_sanitize_removes_ibans():
    result = sanitize_description("TRANSFERENCIA ES9121000418450200051332 NOMINA")

    assert "ES9121000418450200051332" not in result
    assert "NOMINA" in result


def test_sanitize_removes_spaced_ibans():
    assert "ES91" not in sanitize_description("RECIBO ES91 2100 0418 4502 0005 1332")


def test_sanitize_removes_long_digit_runs():
    result = sanitize_description("COMPRA TARJETA 4539148803436467 MERCADONA")

    assert "4539148803436467" not in result
    assert "MERCADONA" in result


def test_sanitize_removes_masked_card_numbers():
    result = sanitize_description("COMPRA TARJ. 5402XXXXXX1234 MERCADONA SA")

    assert "5402" not in result
    assert "MERCADONA" in result


def test_sanitize_removes_asterisk_masked_numbers():
    assert "4539" not in sanitize_description("PAGO 4539********6467 GASOLINERA")


def test_sanitize_removes_masked_numbers_in_groups():
    result = sanitize_description("COMPRA 5402 XXXX XXXX 1234 EN TIENDA")

    assert "5402" not in result
    assert "TIENDA" in result


def test_sanitize_keeps_short_numbers():
    assert "12" in sanitize_description("PARKING 12 H")


def test_sanitize_removes_urls():
    result = sanitize_description("PAYPAL https://evil.example/abc PAGO")

    assert "evil.example" not in result
    assert "PAGO" in result


def test_sanitize_removes_invisible_characters():
    assert sanitize_description("PAGO​OCULTO") == "PAGOOCULTO"


def test_sanitize_truncates_long_text():
    result = sanitize_description("A" * 200)

    assert len(result) <= 80


# --- list_movements ----------------------------------------------------------------


def test_list_movements_returns_only_whitelisted_fields():
    df = _movements([_row("2026-06-01", 10.0)])

    movement = list_movements(df, "2026-06-01", "2026-06-30")["movements"][0]

    assert set(movement) == {"date", "amount", "currency", "type", "category", "description_untrusted"}


def test_list_movements_filters_by_date_range():
    df = _movements([_row("2026-05-31", 10.0), _row("2026-06-15", 20.0), _row("2026-07-01", 30.0)])

    result = list_movements(df, "2026-06-01", "2026-06-30")

    assert [m["amount"] for m in result["movements"]] == [20.0]


def test_list_movements_includes_range_boundaries():
    df = _movements([_row("2026-06-01", 10.0), _row("2026-06-30", 20.0)])

    result = list_movements(df, "2026-06-01", "2026-06-30")

    assert result["matchedCount"] == 2


def test_list_movements_filters_by_category_ignoring_case():
    df = _movements([_row("2026-06-01", 10.0, category="Comida"), _row("2026-06-02", 20.0, category="Ocio")])

    result = list_movements(df, "2026-06-01", "2026-06-30", category="comida")

    assert [m["category"] for m in result["movements"]] == ["Comida"]


def test_list_movements_filters_by_type():
    df = _movements([_row("2026-06-01", 10.0), _row("2026-06-02", 2000.0, type_="income")])

    result = list_movements(df, "2026-06-01", "2026-06-30", type="income")

    assert [m["type"] for m in result["movements"]] == ["income"]


def test_list_movements_filters_by_min_amount():
    df = _movements([_row("2026-06-01", 10.0), _row("2026-06-02", 50.0)])

    result = list_movements(df, "2026-06-01", "2026-06-30", min_amount=20)

    assert [m["amount"] for m in result["movements"]] == [50.0]


def test_list_movements_sanitizes_the_description():
    df = _movements([_row("2026-06-01", 10.0, description="PAGO ES9121000418450200051332")])

    assert list_movements(df, "2026-06-01", "2026-06-30")["movements"][0]["description_untrusted"] == "PAGO"


def test_list_movements_warns_that_the_description_is_untrusted():
    df = _movements([_row("2026-06-01", 10.0)])

    assert "instrucciones" in list_movements(df, "2026-06-01", "2026-06-30")["note"]


def test_list_movements_caps_the_limit():
    df = _movements([_row("2026-06-01", float(i)) for i in range(1, 260)])

    result = list_movements(df, "2026-06-01", "2026-06-30", limit=5000)

    assert len(result["movements"]) == MAX_LIMIT
    assert result["truncated"] is True
    assert result["matchedCount"] == 259


def test_list_movements_returns_the_largest_when_truncated():
    df = _movements([_row("2026-06-01", float(i)) for i in range(1, 11)])

    result = list_movements(df, "2026-06-01", "2026-06-30", limit=2)

    assert [m["amount"] for m in result["movements"]] == [10.0, 9.0]


def test_list_movements_is_not_truncated_when_everything_fits():
    df = _movements([_row("2026-06-01", 10.0)])

    assert list_movements(df, "2026-06-01", "2026-06-30")["truncated"] is False


def test_list_movements_rejects_a_range_longer_than_the_maximum():
    df = _movements([_row("2026-06-01", 10.0)])

    result = list_movements(df, "2025-01-01", "2026-06-30")

    assert "error" in result
    assert str(MAX_RANGE_DAYS) in result["error"]


def test_list_movements_rejects_an_inverted_range():
    df = _movements([_row("2026-06-01", 10.0)])

    assert "error" in list_movements(df, "2026-06-30", "2026-06-01")


def test_list_movements_rejects_unparseable_dates():
    df = _movements([_row("2026-06-01", 10.0)])

    assert "error" in list_movements(df, "junio", "2026-06-30")


def test_list_movements_rejects_an_unknown_type():
    df = _movements([_row("2026-06-01", 10.0)])

    assert "error" in list_movements(df, "2026-06-01", "2026-06-30", type="transfer")


def test_list_movements_rejects_a_non_positive_limit():
    df = _movements([_row("2026-06-01", 10.0)])

    assert "error" in list_movements(df, "2026-06-01", "2026-06-30", limit=0)


def test_list_movements_handles_an_empty_dataframe():
    result = list_movements(pd.DataFrame(columns=["date"]), "2026-06-01", "2026-06-30")

    assert result["movements"] == []
    assert result["matchedCount"] == 0


def test_list_movements_defaults_the_currency_when_the_column_is_missing():
    df = _movements([_row("2026-06-01", 10.0)]).drop(columns=["currency"])

    assert list_movements(df, "2026-06-01", "2026-06-30")["movements"][0]["currency"] == "EUR"
