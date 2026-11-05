"""Verifica que la cuenta lectora del MCP puede leer y NO puede escribir.

Se ejecuta a mano después de aplicar la migración 20260922120000_mcp_data_readers.sql
y de crear el usuario lector. Si algo falla, el candado no está bien puesto.

SUPABASE_URL y SUPABASE_ANON_KEY se leen de wealth-agent/.env (igual que app/config.py),
así que no hay que pegarlas a mano.

Uso:
    READER_EMAIL=... READER_PASSWORD=... OWNER_USER_ID=... \
    python scripts/verify_reader_readonly.py
"""

import os
import sys

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

REQUIRED = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "READER_EMAIL", "READER_PASSWORD", "OWNER_USER_ID"]

results = []


def check(name, passed, detail=""):
    results.append((name, passed, detail))
    print(f"{'PASS' if passed else 'FAIL'}  {name}{f' — {detail}' if detail else ''}")


def main():
    missing = [v for v in REQUIRED if not os.getenv(v)]
    if missing:
        sys.exit(f"Faltan variables de entorno: {', '.join(missing)}")

    owner_id = os.environ["OWNER_USER_ID"]
    client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])
    client.auth.sign_in_with_password(
        {"email": os.environ["READER_EMAIL"], "password": os.environ["READER_PASSWORD"]}
    )

    # 1. Lectura: el lector ve los movimientos del dueño.
    movements = client.table("movements").select("id, user_id, description").limit(50).execute().data
    check("El lector puede leer movements", len(movements) > 0, f"{len(movements)} filas")
    if not movements:
        sys.exit("Sin filas que probar: revisa la fila de data_readers y el OWNER_USER_ID.")

    # 2. Aislamiento: solo filas del dueño, de nadie más.
    other_owners = {row["user_id"] for row in movements} - {owner_id}
    check("El lector solo ve filas del dueño", not other_owners, f"otros user_id: {other_owners or 'ninguno'}")

    # 3. Lectura del portfolio.
    positions = client.table("portfolio_positions").select("id, user_id").limit(50).execute().data
    foreign = {row["user_id"] for row in positions} - {owner_id}
    check("El lector puede leer portfolio_positions y solo del dueño", not foreign, f"{len(positions)} filas")

    target = movements[0]
    original_description = target["description"]

    # 4. Insert: sin política de insert, Postgres lo rechaza con un error.
    try:
        client.table("movements").insert(
            {"user_id": owner_id, "type": "expense", "date": "2026-01-01",
             "category": "MCP_PROBE", "amount": 1.23}
        ).execute()
        check("El insert del lector es rechazado", False, "el insert PASÓ: falta cerrar la escritura")
    except Exception as exc:  # noqa: BLE001 — cualquier rechazo del servidor vale
        check("El insert del lector es rechazado", True, type(exc).__name__)

    # 5. Update: sin política de update las filas quedan filtradas, así que la
    #    llamada no falla pero no debe modificar nada. Se comprueba releyendo.
    try:
        client.table("movements").update({"description": "MCP_READONLY_PROBE"}).eq("id", target["id"]).execute()
    except Exception:  # noqa: BLE001
        pass
    after = client.table("movements").select("description").eq("id", target["id"]).execute().data
    check("El update del lector no cambia nada", bool(after) and after[0]["description"] == original_description,
          f"description = {after[0]['description'] if after else 'fila desaparecida'!r}")

    # 6. Delete: mismo razonamiento; la fila tiene que seguir ahí.
    try:
        client.table("movements").delete().eq("id", target["id"]).execute()
    except Exception:  # noqa: BLE001
        pass
    still_there = client.table("movements").select("id").eq("id", target["id"]).execute().data
    check("El delete del lector no borra nada", bool(still_there))

    failed = [name for name, passed, _ in results if not passed]
    print()
    if failed:
        sys.exit(f"{len(failed)} comprobación(es) fallida(s): {', '.join(failed)}")
    print("Todo correcto: el lector puede leer y no puede escribir.")


if __name__ == "__main__":
    main()
