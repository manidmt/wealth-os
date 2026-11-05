"""Cliente Supabase de la cuenta lectora del MCP.

El servidor MCP es un proceso de larga vida, así que la sesión se cachea y se
renueva volviendo a autenticarse cuando está a punto de caducar. Las queries
salen con el token del lector, cuyas políticas RLS son solo de SELECT.
"""

import time
from typing import Callable

from supabase import create_client

from app.mcp_config import McpConfig, load_config

# Margen para no usar un token que caduca a mitad de la llamada.
REFRESH_MARGIN_SECONDS = 60

_client = None
_expires_at: float | None = None


def needs_refresh(expires_at: float | None, now: float, margin: float = REFRESH_MARGIN_SECONDS) -> bool:
    if expires_at is None:
        return True
    return now >= expires_at - margin


def reset_reader_client() -> None:
    """Olvida la sesión cacheada (lo usan los tests)."""
    global _client, _expires_at
    _client = None
    _expires_at = None


def get_reader_client(config: McpConfig | None = None, now: Callable[[], float] = time.time):
    global _client, _expires_at

    if _client is not None and not needs_refresh(_expires_at, now()):
        return _client

    config = config or load_config()
    client = _client if _client is not None else create_client(config.supabase_url, config.supabase_anon_key)

    try:
        response = client.auth.sign_in_with_password(
            {"email": config.reader_email, "password": config.reader_password}
        )
    except Exception as exc:
        # El mensaje original puede acabar en logs o en la salida del MCP: se
        # nombra al usuario, nunca la contraseña.
        raise type(exc)(
            f"No se pudo autenticar la cuenta lectora {config.reader_email}: {exc}. "
            f"Revisa READER_EMAIL y READER_PASSWORD."
        ) from exc

    session = response.session
    client.postgrest.auth(session.access_token)

    _client = client
    _expires_at = float(session.expires_at) if session.expires_at is not None else None
    return _client
