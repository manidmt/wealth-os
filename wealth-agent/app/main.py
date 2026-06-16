from fastapi import FastAPI
from app.routers import chat

app = FastAPI(title="WealthFinancial Agent API")
app.include_router(chat.router)

@app.get("/health")
def health():
    return {"status": "ok"}