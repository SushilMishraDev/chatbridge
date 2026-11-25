import time
import urllib.parse
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User
from ..schemas import HandoffIn
from ..security import get_current_user
from ..services.context_builder import build_context, make_handoff_prompt
from ..services.summarizer import summarize
from .chats import own_conversation

router = APIRouter()

TARGETS = {  # public start pages; sites change their URLs
    "chatgpt": "https://chatgpt.com/",
    "claude": "https://claude.ai/new",
    "gemini": "https://gemini.google.com/app",
}

# Cache recent handoffs in-memory so the extension or external tabs can retrieve them
RECENT_HANDOFFS = {}


@router.post("/handoff")
def handoff(
    body: HandoffIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if body.target not in TARGETS:
        raise HTTPException(400, "Unknown target")
    convo = own_conversation(db, user, body.conversation_id)
    messages = [{"role": m.role, "content": m.content} for m in convo.messages]
    kept, dropped = build_context(messages)
    summary = summarize(dropped) if dropped else None
    prompt = make_handoff_prompt(
        kept,
        summary,
        body.next_message,
        source_platform=convo.source,
        target_platform=body.target,
    )

    # Target URLs for all 3 AI platforms
    target_url = TARGETS[body.target]

    # Store in memory for extension direct retrieval (valid for 30 minutes)
    payload = {
        "prompt": prompt,
        "next_message": body.next_message or "Please continue our conversation from where we stopped.",
        "messages": kept,
        "url": target_url,
        "target": body.target,
        "timestamp": time.time(),
        "conversation_id": body.conversation_id,
        "title": convo.title,
    }
    RECENT_HANDOFFS[body.target] = payload
    RECENT_HANDOFFS["latest"] = payload

    return {
        "prompt": prompt,
        "next_message": payload["next_message"],
        "messages": kept,
        "url": target_url,
        "kept": len(kept),
        "summarized": len(dropped),
    }


@router.get("/handoff/latest")
def get_latest_handoff(target: Optional[str] = Query(None)):
    """Allows the Chrome extension to query the most recently generated handoff prompt

    even across isolated tabs, without requiring local DOM message passing.
    """
    key = target if (target and target in RECENT_HANDOFFS) else "latest"
    handoff_data = RECENT_HANDOFFS.get(key)
    if not handoff_data and "latest" in RECENT_HANDOFFS:
        handoff_data = RECENT_HANDOFFS.get("latest")
    if not handoff_data:
        return {"prompt": None}

    # Expire after 30 minutes
    if time.time() - handoff_data.get("timestamp", 0) > 1800:
        return {"prompt": None, "expired": True}

    return {
        "prompt": handoff_data.get("prompt"),
        "next_message": handoff_data.get("next_message"),
        "messages": handoff_data.get("messages", []),
        "url": handoff_data.get("url"),
        "target": handoff_data.get("target"),
        "title": handoff_data.get("title"),
        "timestamp": handoff_data.get("timestamp"),
    }

