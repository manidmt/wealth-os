import pytest

from app.mcp_config import McpConfig
from app.services import reader_client

CONFIG = McpConfig(
    supabase_url="https://example.supabase.co",
    supabase_anon_key="anon-key",
    reader_email="reader@example.com",
    reader_password="secret",
    owner_user_id="00000000-0000-0000-0000-000000000001",
)


class _FakeAuth:
    def __init__(self, client):
        self._client = client

    def sign_in_with_password(self, credentials):
        self._client.sign_ins.append(credentials)
        return type("Response", (), {"session": type("Session", (), {
            "access_token": f"token-{len(self._client.sign_ins)}",
            "expires_at": self._client.expires_at,
        })()})()


class _FakePostgrest:
    def __init__(self, client):
        self._client = client

    def auth(self, token):
        self._client.tokens.append(token)


class _FakeClient:
    def __init__(self, expires_at):
        self.sign_ins = []
        self.tokens = []
        self.expires_at = expires_at
        self.auth = _FakeAuth(self)
        self.postgrest = _FakePostgrest(self)


@pytest.fixture
def fake_supabase(monkeypatch):
    created = []

    def factory(url, key):
        created.append((url, key))
        client = _FakeClient(expires_at=1_000.0)
        factory.clients.append(client)
        return client

    factory.clients = []
    factory.created = created
    monkeypatch.setattr(reader_client, "create_client", factory)
    reader_client.reset_reader_client()
    yield factory
    reader_client.reset_reader_client()


def test_signs_in_as_the_reader_with_the_anon_key(fake_supabase):
    client = reader_client.get_reader_client(CONFIG, now=lambda: 0.0)

    assert fake_supabase.created == [("https://example.supabase.co", "anon-key")]
    assert client.sign_ins == [{"email": "reader@example.com", "password": "secret"}]


def test_passes_the_access_token_to_postgrest(fake_supabase):
    client = reader_client.get_reader_client(CONFIG, now=lambda: 0.0)

    assert client.tokens == ["token-1"]


def test_reuses_the_cached_session_while_it_is_valid(fake_supabase):
    first = reader_client.get_reader_client(CONFIG, now=lambda: 0.0)
    second = reader_client.get_reader_client(CONFIG, now=lambda: 500.0)

    assert first is second
    assert len(first.sign_ins) == 1


def test_signs_in_again_when_the_session_is_about_to_expire(fake_supabase):
    client = reader_client.get_reader_client(CONFIG, now=lambda: 0.0)
    reader_client.get_reader_client(CONFIG, now=lambda: 999.0)

    assert len(client.sign_ins) == 2
    assert client.tokens == ["token-1", "token-2"]


def test_needs_refresh_without_a_session():
    assert reader_client.needs_refresh(None, now=0.0) is True


def test_needs_refresh_respects_the_margin():
    assert reader_client.needs_refresh(1_000.0, now=1_000.0 - reader_client.REFRESH_MARGIN_SECONDS - 1) is False
    assert reader_client.needs_refresh(1_000.0, now=1_000.0 - reader_client.REFRESH_MARGIN_SECONDS + 1) is True


def test_reports_a_failed_sign_in_without_echoing_the_password(fake_supabase, monkeypatch):
    def failing_sign_in(credentials):
        raise RuntimeError("Invalid login credentials")

    def factory(url, key):
        client = _FakeClient(expires_at=1_000.0)
        client.auth.sign_in_with_password = failing_sign_in
        return client

    monkeypatch.setattr(reader_client, "create_client", factory)

    with pytest.raises(RuntimeError) as excinfo:
        reader_client.get_reader_client(CONFIG, now=lambda: 0.0)

    assert "secret" not in str(excinfo.value)
    assert "reader@example.com" in str(excinfo.value)
