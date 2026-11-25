import os
os.environ["SQLALCHEMY_DISABLE_C_EXTENSIONS"] = "1"
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# Load .env from project root or backend folder before other app imports
load_dotenv(Path(__file__).resolve().parents[2] / ".env")
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from .database import Base, engine
from .routes import auth, chats, export, handoff, imports, sync

Base.metadata.create_all(engine)

app = FastAPI(title="ChatBridge", description="Save AI chats and continue them on another AI.")

# CORS middleware supporting localhost, extension, and deployed domains
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (auth.router, sync.router, chats.router, handoff.router, imports.router, export.router):
    app.include_router(r)


@app.get("/health")
def health():
    return {"ok": True, "service": "chatbridge"}


# Serve production build of frontend when available (all-in-one fullstack deployment)
DIST_DIR = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if DIST_DIR.exists():
    if (DIST_DIR / "assets").exists():
        app.mount("/assets", StaticFiles(directory=str(DIST_DIR / "assets")), name="assets")

    @app.get("/{full_path:path}")
    def serve_frontend_spa(full_path: str):
        target = DIST_DIR / full_path
        if target.is_file():
            return FileResponse(target)
        return FileResponse(DIST_DIR / "index.html")
