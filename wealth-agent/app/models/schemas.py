from pydantic import BaseModel
from typing import Optional, List


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class IncomingMessage(BaseModel):
    message: str
    user_id: str
    history: Optional[List[ChatMessage]] = []