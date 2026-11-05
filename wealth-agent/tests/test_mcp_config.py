import os

import pytest

from app.mcp_config import REQUIRED_KEYS, config_path, load_config

VALID = """SUPABASE_URL=https://example.supabase.co
SUPABASE_ANON_KEY=anon-key
READER_EMAIL=reader@example.com
READER_PASSWORD=secret
OWNER_USER_ID=00000000-0000-0000-0000-000000000001
"""


def _write(tmp_path, content=VALID, mode=0o600):
    path = tmp_path / "env"
    path.write_text(content)
    path.chmod(mode)
    return path


def test_load_config_reads_every_field(tmp_path):
    config = load_config(_write(tmp_path))

    assert config.supabase_url == "https://example.supabase.co"
    assert config.supabase_anon_key == "anon-key"
    assert config.reader_email == "reader@example.com"
    assert config.reader_password == "secret"
    assert config.owner_user_id == "00000000-0000-0000-0000-000000000001"


def test_load_config_explains_how_to_create_a_missing_file(tmp_path):
    missing = tmp_path / "no-existe"

    with pytest.raises(FileNotFoundError) as excinfo:
        load_config(missing)

    message = str(excinfo.value)
    assert str(missing) in message
    assert "chmod 600" in message
    assert all(key in message for key in REQUIRED_KEYS)


def test_load_config_names_the_missing_keys(tmp_path):
    path = _write(tmp_path, "SUPABASE_URL=https://example.supabase.co\nREADER_EMAIL=reader@example.com\n")

    with pytest.raises(ValueError) as excinfo:
        load_config(path)

    message = str(excinfo.value)
    assert "SUPABASE_ANON_KEY" in message
    assert "READER_PASSWORD" in message
    assert "OWNER_USER_ID" in message
    assert "SUPABASE_URL" not in message


def test_load_config_rejects_empty_values(tmp_path):
    path = _write(tmp_path, VALID.replace("READER_PASSWORD=secret", "READER_PASSWORD="))

    with pytest.raises(ValueError, match="READER_PASSWORD"):
        load_config(path)


def test_load_config_refuses_a_file_other_users_can_read(tmp_path):
    path = _write(tmp_path, mode=0o644)

    with pytest.raises(PermissionError, match="chmod 600"):
        load_config(path)


def test_load_config_accepts_read_only_owner_permissions(tmp_path):
    assert load_config(_write(tmp_path, mode=0o400)).reader_email == "reader@example.com"


def test_config_path_can_be_overridden_by_env(tmp_path, monkeypatch):
    monkeypatch.setenv("WEALTH_MCP_ENV", str(tmp_path / "otro"))

    assert config_path() == tmp_path / "otro"


def test_config_path_defaults_under_the_user_config_dir(monkeypatch):
    monkeypatch.delenv("WEALTH_MCP_ENV", raising=False)

    assert config_path().parts[-3:] == (".config", "wealth-mcp", "env")


def test_load_config_does_not_leak_the_password_into_the_environment(tmp_path, monkeypatch):
    monkeypatch.delenv("READER_PASSWORD", raising=False)

    load_config(_write(tmp_path))

    assert "READER_PASSWORD" not in os.environ
