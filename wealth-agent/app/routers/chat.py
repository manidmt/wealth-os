import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.models.schemas import ChatMessage
from app.services.agent_service import run_agent_stream

router = APIRouter()


@router.websocket("/ws/{user_id}")
async def websocket_chat(websocket: WebSocket, user_id: str):
    await websocket.accept()
    try:
        while True:
            raw = await websocket.receive_text()
            print(f">>> RAW recibido: {repr(raw)}")
            data = json.loads(raw)
            message = data.get("message", "")
            history = [ChatMessage(**m) for m in data.get("history", [])]
            context = data.get("context")

            if not message:
                await websocket.send_text(json.dumps({"error": "Mensaje vacío"}))
                continue

            async for token in run_agent_stream(user_id, message, history, context):
                await websocket.send_text(json.dumps({"token": token}))

            await websocket.send_text(json.dumps({"done": True}))

    except WebSocketDisconnect:
        pass
    except Exception as e:
        await websocket.send_text(json.dumps({"error": str(e)}))