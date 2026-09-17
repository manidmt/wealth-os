import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.models.schemas import ChatMessage
from app.services.agent_service import run_agent_stream
from app.services.data_service import get_supabase_client

router = APIRouter()


def _authenticated_user_id(token: str | None) -> str | None:
    """Valida el JWT de Supabase contra Auth y devuelve el user_id real, o None."""
    if not token:
        return None
    try:
        resp = get_supabase_client().auth.get_user(token)
    except Exception:
        return None
    return resp.user.id if resp and resp.user else None


@router.websocket("/ws/{user_id}")
async def websocket_chat(websocket: WebSocket, user_id: str):
    await websocket.accept()

    auth_token = websocket.query_params.get("token")
    real_user_id = _authenticated_user_id(auth_token)
    if real_user_id is None or real_user_id != user_id:
        await websocket.send_text(json.dumps({"error": "No autorizado"}))
        await websocket.close(code=4401)
        return

    try:
        while True:
            raw = await websocket.receive_text()
            print(f">>> RAW recibido: {repr(raw)}")
            data = json.loads(raw)
            message = data.get("message", "")
            history = [ChatMessage(**m) for m in data.get("history", [])]
            context = data.get("context")
            remember = bool(data.get("remember", False))

            if not message:
                await websocket.send_text(json.dumps({"error": "Mensaje vacío"}))
                continue

            async for token in run_agent_stream(user_id, message, history, context, remember):
                await websocket.send_text(json.dumps({"token": token}))

            await websocket.send_text(json.dumps({"done": True}))

    except WebSocketDisconnect:
        pass
    except Exception as e:
        await websocket.send_text(json.dumps({"error": str(e)}))