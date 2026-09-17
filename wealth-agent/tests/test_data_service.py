from unittest.mock import MagicMock, patch

from app.services.data_service import get_supabase_client, load_table


@patch("app.services.data_service.create_client")
def test_get_supabase_client_scopes_to_user_token(mock_create_client):
    client = MagicMock()
    mock_create_client.return_value = client

    get_supabase_client("user-jwt")

    client.postgrest.auth.assert_called_once_with("user-jwt")


@patch("app.services.data_service.create_client")
def test_get_supabase_client_without_token_does_not_attach_auth(mock_create_client):
    client = MagicMock()
    mock_create_client.return_value = client

    get_supabase_client()

    client.postgrest.auth.assert_not_called()


def test_load_table_paginates_until_a_short_page():
    page_1 = [{"id": i} for i in range(1000)]
    page_2 = [{"id": 1000}]

    responses = iter([MagicMock(data=page_1), MagicMock(data=page_2)])
    supabase = MagicMock()
    query = supabase.table.return_value.select.return_value.eq.return_value.range.return_value
    query.execute.side_effect = lambda: next(responses)

    df = load_table(supabase, "movements", "user-1")

    assert len(df) == 1001
    supabase.table.assert_called_with("movements")
    supabase.table.return_value.select.return_value.eq.assert_called_with("user_id", "user-1")


def test_load_table_returns_empty_dataframe_when_no_rows():
    supabase = MagicMock()
    query = supabase.table.return_value.select.return_value.eq.return_value.range.return_value
    query.execute.return_value = MagicMock(data=[])

    df = load_table(supabase, "movements", "user-1")

    assert df.empty
