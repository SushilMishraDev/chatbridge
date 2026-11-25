from fastapi import APIRouter, Depends, HTTPException
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

    return {
        "prompt": prompt,
        "next_message": body.next_message or "Please continue our conversation from where we stopped.",
        "messages": kept,
        "url": target_url,
        "kept": len(kept),
        "summarized": len(dropped),
    }

