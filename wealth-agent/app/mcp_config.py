"""Configuración del servidor MCP: credenciales de la cuenta lectora.

Vive aparte de app/config.py (que es la del agente FastAPI) porque son
credenciales distintas: aquí va el usuario lector, que solo puede hacer SELECT.
El archivo no se guarda en el repo ni en el llavero: ver el README del agente.
"""

from dataclasses import dataclass
from pathlib import Path
import os
import stat

from dotenv import dotenv_values

ENV_PATH_VAR = "WEALTH_MCP_ENV"
DEFAULT_ENV_PATH = Path.home() / ".config" / "wealth-mcp" / "env"

REQUIRED_KEYS = (
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "READER_EMAIL",
    "READER_PASSWORD",
    "OWNER_USER_ID",
)


@dataclass(frozen=True)
class McpConfig:
    supabase_url: str
    supabase_anon_key: str
    reader_email: str
    reader_password: str
    owner_user_id: str


def config_path() -> Path:
    override = os.getenv(ENV_PATH_VAR)
    return Path(override) if override else DEFAULT_ENV_PATH


def load_config(path: Path | None = None) -> McpConfig:
    path = Path(path) if path is not None else config_path()

    if not path.is_file():
        raise FileNotFoundError(
            f"No encuentro las credenciales del MCP en {path}. Créalo con las claves "
            f"{', '.join(REQUIRED_KEYS)} (una por línea) y protégelo con chmod 600. "
            "Instrucciones en wealth-agent/README.md."
        )

    # El archivo guarda la contraseña del lector: si otros usuarios pueden leerlo,
    # paramos en vez de seguir como si nada.
    mode = stat.S_IMODE(path.stat().st_mode)
    if mode & 0o077:
        raise PermissionError(
            f"{path} es legible por otros usuarios (permisos {mode:03o}). "
            f"Ejecuta: chmod 600 {path}"
        )

    # dotenv_values lee el archivo sin tocar os.environ, así que la contraseña no
    # queda expuesta a subprocesos.
    values = dotenv_values(path)
    missing = [key for key in REQUIRED_KEYS if not (values.get(key) or "").strip()]
    if missing:
        raise ValueError(f"Faltan claves (o están vacías) en {path}: {', '.join(missing)}")

    return McpConfig(
        supabase_url=values["SUPABASE_URL"].strip(),
        supabase_anon_key=values["SUPABASE_ANON_KEY"].strip(),
        reader_email=values["READER_EMAIL"].strip(),
        reader_password=values["READER_PASSWORD"],
        owner_user_id=values["OWNER_USER_ID"].strip(),
    )
