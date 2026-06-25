import pandas as pd
from datetime import timedelta
from supabase import create_client
from app.config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY


def get_supabase_client():
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def load_table(supabase, table_name, user_id):
    all_rows = []
    page_size = 1000
    offset = 0
    while True:
        response = (
            supabase.table(table_name)
            .select("*")
            .eq("user_id", user_id)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = response.data
        if not rows:
            break
        all_rows.extend(rows)
        if len(rows) < page_size:
            break
        offset += page_size
    return pd.DataFrame(all_rows)


def load_user_data(user_id):
    supabase = get_supabase_client()
    df_movements = load_table(supabase, "movements", user_id)
    df_portfolio = load_table(supabase, "portfolio_positions", user_id)
    # Usuario sin movimientos: load_table devuelve un DataFrame vacío sin columnas.
    # Devolvemos uno con la columna 'date' para que el resto del flujo no rompa.
    if df_movements.empty:
        df_movements = pd.DataFrame(columns=["date"])
        return df_movements, df_movements.copy(), df_portfolio
    df_movements["date"] = pd.to_datetime(df_movements["date"])
    max_date = df_movements["date"].max()
    min_date = max_date - timedelta(days=180)
    df_movements_recent = df_movements[df_movements["date"] >= min_date].copy()
    return df_movements, df_movements_recent, df_portfolio