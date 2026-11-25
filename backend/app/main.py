import os
os.environ["SQLALCHEMY_DISABLE_C_EXTENSIONS"] = "1"
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

# Load .env from project root or backend folder before other app imports
load_dotenv(Path(__file__).resolve().parents[2] / ".env")
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from .database import Base, engine
from .routes import auth, chats, export, handoff, imports, sync, web

Base.metadata.create_all(engine)

app = FastAPI(title="ChatBridge", description="Save AI chats and continue them on another AI.")

for r in (auth.router, sync.router, chats.router, handoff.router, imports.router, export.router):
    app.include_router(r)
app.include_router(web.router)

STATIC_DIR = Path(__file__).resolve().parent / "static"
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/health")
def health():
    return {"ok": True, "service": "chatbridge"}


@app.get("/", include_in_schema=False)
def home():
    return RedirectResponse("/ui", status_code=303)
