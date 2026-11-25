import json
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Conversation, User
from ..security import get_current_user
from .chats import own_conversation

router = APIRouter()


def safe_name(title: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "_", title).strip("_")[:50] or "chat"


def as_dict(c: Conversation) -> dict:
    return {
        "source": c.source,
        "external_id": c.external_id,
        "title": c.title,
        "messages": [{"role": m.role, "content": m.content} for m in c.messages],
    }


def render(c: Conversation, fmt: str) -> tuple[str, str]:
    if fmt == "json":
        return (
            json.dumps({"conversations": [as_dict(c)]}, indent=2, ensure_ascii=False),
            "application/json",
        )
    if fmt == "txt":
        body = "\n\n".join(f"{m.role.upper()}: {m.content}" for m in c.messages)
        return f"{c.title}\n\n{body}", "text/plain; charset=utf-8"
    if fmt == "md":
        body = "\n\n".join(
            f"**{'You' if m.role == 'user' else 'AI'}:**\n\n{m.content}" for m in c.messages
        )
        return f"# {c.title}\n\n_Source: {c.source}_\n\n{body}", "text/markdown; charset=utf-8"
    raise HTTPException(400, "format must be md, txt or json")


def download(text: str, media: str, filename: str) -> Response:
    return Response(
        text,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/chats/{chat_id}/export")
def export_chat(
    chat_id: int,
    format: str = "md",
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = own_conversation(db, user, chat_id)
    text, media = render(c, format)
    return download(text, media, f"{safe_name(c.title)}.{format}")


@router.get("/export")
def export_all(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(Conversation).filter_by(user_id=user.id).all()
    data = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "conversations": [as_dict(c) for c in rows],
    }
    return download(
        json.dumps(data, indent=2, ensure_ascii=False),
        "application/json",
        "chatbridge-export.json",
    )
