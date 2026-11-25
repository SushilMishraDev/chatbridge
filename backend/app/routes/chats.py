from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Conversation, Message, User
from ..security import get_current_user
from ..services.seed_data import is_test_environment, seed_chats_for_user

router = APIRouter()


def own_conversation(db: Session, user: User, convo_id: int) -> Conversation:
    convo = db.query(Conversation).filter_by(id=convo_id, user_id=user.id).first()
    if convo is None:
        raise HTTPException(404, "Not found")  # 404 hides that it exists
    return convo


@router.get("/chats")
def list_chats(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (
        db.query(Conversation)
        .filter(
            Conversation.user_id == user.id,
            ~Conversation.external_id.like("seed-%"),
            ~Conversation.external_id.like("demo-%"),
        )
        .order_by(Conversation.updated_at.desc())
        .all()
    )
    img_convo_ids = set(
        row[0]
        for row in db.query(Message.conversation_id)
        .filter(
            (Message.content.like("%![%"))
            | (Message.content.like("%[Image%"))
            | (Message.content.like("%[Attached%"))
            | (Message.content.like("%📁%"))
            | (Message.content.like("%.pdf%"))
            | (Message.content.like("%.png%"))
            | (Message.content.like("%.jpg%"))
            | (Message.content.like("%.jpeg%"))
            | (Message.content.like("%data:image%"))
        )
        .distinct()
        .all()
    )
    return [
        {
            "id": c.id,
            "source": c.source,
            "external_id": c.external_id,
            "title": c.title,
            "messages": len(c.messages),
            "updated_at": c.updated_at,
            "is_sample": False,
            "has_images": c.id in img_convo_ids,
        }
        for c in rows
    ]


@router.post("/chats/seed")
def seed_chats(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    added = seed_chats_for_user(db, user.id, force=True)
    return {"added": added, "status": "ok"}


@router.post("/chats/clear-samples")
def clear_samples(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    samples = (
        db.query(Conversation)
        .filter(
            Conversation.user_id == user.id,
            (Conversation.external_id.like("seed-%"))
            | (Conversation.external_id.like("demo-%")),
        )
        .all()
    )
    count = len(samples)
    for s in samples:
        db.delete(s)
    db.commit()
    return {"deleted": count, "status": "ok"}


@router.get("/chats/{chat_id}")
def get_chat(
    chat_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = own_conversation(db, user, chat_id)
    return {
        "id": c.id,
        "source": c.source,
        "title": c.title,
        "updated_at": c.updated_at,
        "is_sample": bool(
            c.external_id
            and (c.external_id.startswith("seed-") or c.external_id.startswith("demo-"))
        ),
        "messages": [
            {"role": m.role, "content": m.content}
            for m in sorted(c.messages, key=lambda x: x.position if x.position is not None else x.id)
        ],
    }


@router.delete("/chats/{chat_id}")
def delete_chat(
    chat_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.delete(own_conversation(db, user, chat_id))
    db.commit()
    return {"deleted": chat_id}
