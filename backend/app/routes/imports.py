import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Conversation, Message, User, now
from ..schemas import PasteImportIn
from ..security import get_current_user
from ..services.import_parsers import (
    MAX_UPLOAD_BYTES,
    ImportError_,
    make_pasted_external_id,
    parse_export,
    parse_pasted_chat,
)

router = APIRouter()


async def _items(platform: str, file: UploadFile):
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    try:
        return parse_export(platform, raw, file.filename or "")
    except ImportError_ as e:
        raise HTTPException(400, str(e)) from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.post("/import/paste")
def import_pasted(
    body: PasteImportIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    title = body.title.strip()[:200]
    if not title:
        raise HTTPException(400, "Please provide a conversation title")

    messages = parse_pasted_chat(body.content)
    if not messages:
        raise HTTPException(400, "Could not find any readable messages in the pasted text")

    source = (body.source or "chatgpt").lower()
    external_id = make_pasted_external_id(title)

    # Check by both external_id and exact title for this user to ensure duplicate imports are caught
    convo = (
        db.query(Conversation)
        .filter(
            Conversation.user_id == user.id,
            Conversation.source == source,
            (Conversation.external_id == external_id) | (Conversation.title == title),
        )
        .first()
    )

    if convo is not None:
        if len(convo.messages) >= len(messages):
            # Already exists with equal or more messages; avoid duplicate appending
            return {
                "id": convo.id,
                "title": convo.title,
                "status": "already_exists",
                "message_count": len(convo.messages),
                "replaced": False,
                "info": f"A conversation with the title '{convo.title}' is already saved with {len(convo.messages)} messages. No duplicate was created.",
            }
        else:
            # Newer paste has more messages; update the conversation cleanly without duplicate entries
            convo.title = title
            convo.messages.clear()
            db.flush()
            for i, m in enumerate(messages):
                convo.messages.append(Message(position=i, role=m["role"], content=m["content"]))
            convo.updated_at = now()
            db.commit()
            return {
                "id": convo.id,
                "title": convo.title,
                "status": "updated",
                "message_count": len(messages),
                "replaced": True,
                "info": f"Updated existing conversation '{title}' with {len(messages)} messages.",
            }

    # Brand new conversation
    convo = Conversation(
        user_id=user.id,
        source=source,
        external_id=external_id,
        title=title,
    )
    db.add(convo)
    db.flush()
    for i, m in enumerate(messages):
        convo.messages.append(Message(position=i, role=m["role"], content=m["content"]))
    convo.updated_at = now()
    db.commit()

    return {
        "id": convo.id,
        "title": convo.title,
        "status": "created",
        "message_count": len(messages),
        "replaced": True,
        "info": f"Saved '{title}' with {len(messages)} messages.",
    }


@router.post("/import/{platform}/preview")
async def preview(
    platform: str,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    items = await _items(platform, file)
    return [
        {
            "external_id": i["external_id"],
            "title": i["title"],
            "messages": len(i["messages"]),
        }
        for i in items
    ]


@router.post("/import/{platform}")
async def do_import(
    platform: str,
    file: UploadFile = File(...),
    selected: str = Form("[]"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    items = await _items(platform, file)
    try:
        chosen = set(json.loads(selected))
    except ValueError as e:
        raise HTTPException(400, "Bad selection") from e
    if chosen:
        items = [i for i in items if i["external_id"] in chosen]
    imported = skipped = 0
    for it in items:
        convo = (
            db.query(Conversation)
            .filter_by(user_id=user.id, source=it["source"], external_id=it["external_id"])
            .first()
        )
        if convo is None:
            convo = Conversation(
                user_id=user.id,
                source=it["source"],
                external_id=it["external_id"],
                title=it["title"][:200],
            )
            db.add(convo)
            db.flush()
        elif len(convo.messages) >= len(it["messages"]):
            skipped += 1  # never replace with a shorter or equal copy
            continue
        else:
            convo.title = it["title"][:200]
            convo.messages.clear()
            db.flush()
        for i, m in enumerate(it["messages"]):
            convo.messages.append(Message(position=i, role=m["role"], content=m["content"]))
        convo.updated_at = now()
        imported += 1
    db.commit()  # one commit for the whole import
    return {"imported": imported, "skipped": skipped}
