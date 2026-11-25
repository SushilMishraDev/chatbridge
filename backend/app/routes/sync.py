from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Conversation, Message, User, now
from ..schemas import SyncIn
from ..security import get_current_user

router = APIRouter()


def parse_timestamp(val):
    if not val:
        return now()
    try:
        if isinstance(val, (int, float)):
            return datetime.fromtimestamp(val, tz=timezone.utc)
        cleaned = str(val).replace("Z", "+00:00")
        return datetime.fromisoformat(cleaned)
    except Exception:
        return now()


@router.post("/sync")
def sync(
    body: SyncIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    convo = (
        db.query(Conversation)
        .filter_by(user_id=user.id, source=body.source, external_id=body.external_id)
        .first()
    )
    if convo is None:
        convo = Conversation(
            user_id=user.id,
            source=body.source,
            external_id=body.external_id,
            title=body.title[:200],
        )
        db.add(convo)
        db.flush()
    elif len(convo.messages) > len(body.messages):
        # never replace a saved chat with a shorter copy
        return {"id": convo.id, "stored": len(convo.messages), "replaced": False}
    elif len(convo.messages) == len(body.messages) and convo.title == body.title[:200]:
        # Conversation is identical! Already in the database with full history!
        return {"id": convo.id, "stored": len(convo.messages), "replaced": False, "already_synced": True}
    else:
        convo.title = body.title[:200]
        convo.messages.clear()  # delete-orphan removes the old rows
        db.flush()

    if body.created_at:
        convo.created_at = parse_timestamp(body.created_at)

    for i, m in enumerate(body.messages):
        convo.messages.append(Message(position=i, role=m.role, content=m.content))
    convo.updated_at = parse_timestamp(body.updated_at) if body.updated_at else now()
    db.commit()
    return {"id": convo.id, "stored": len(body.messages), "replaced": True}


@router.post("/sync/batch")
def sync_batch(
    body: list[SyncIn],
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    results = []
    for item in body:
        convo = (
            db.query(Conversation)
            .filter_by(user_id=user.id, source=item.source, external_id=item.external_id)
            .first()
        )
        if convo is None:
            convo = Conversation(
                user_id=user.id,
                source=item.source,
                external_id=item.external_id,
                title=item.title[:200],
            )
            db.add(convo)
            db.flush()
        elif len(convo.messages) >= len(item.messages):
            results.append({"id": convo.id, "title": convo.title, "stored": len(convo.messages), "replaced": False})
            continue
        else:
            convo.title = item.title[:200]
            convo.messages.clear()
            db.flush()

        if item.created_at:
            convo.created_at = parse_timestamp(item.created_at)

        for i, m in enumerate(item.messages):
            convo.messages.append(Message(position=i, role=m.role, content=m.content))
        convo.updated_at = parse_timestamp(item.updated_at) if item.updated_at else now()
        results.append({"id": convo.id, "title": convo.title, "stored": len(item.messages), "replaced": True})

    db.commit()
    return {"total": len(body), "saved": len(results), "items": results}
