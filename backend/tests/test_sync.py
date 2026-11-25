import os

os.environ["JWT_SECRET"] = "test-secret-test-secret-test-secret"
os.environ["DATABASE_URL"] = "sqlite:///./test.db"

from fastapi.testclient import TestClient

from app.database import Base, engine
from app.main import app

Base.metadata.drop_all(engine)
Base.metadata.create_all(engine)

client = TestClient(app)


def register(email):
    r = client.post("/register", json={"email": email, "password": "password123"})
    return {"Authorization": f"Bearer {r.json()['token']}"}


CHAT = {
    "source": "chatgpt",
    "external_id": "abc",
    "title": "T",
    "messages": [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "hello"},
    ],
}


def test_sync_twice_one_chat_and_shorter_copy_kept():
    h = register("a@example.com")
    client.post("/sync", json=CHAT, headers=h)
    client.post("/sync", json=CHAT, headers=h)
    assert len(client.get("/chats", headers=h).json()) == 1
    short = {**CHAT, "messages": CHAT["messages"][:1]}
    r = client.post("/sync", json=short, headers=h).json()
    assert r["replaced"] is False and r["stored"] == 2


def test_other_user_gets_404():
    a, b = register("o1@example.com"), register("o2@example.com")
    chat_id = client.post("/sync", json={**CHAT, "external_id": "zzz"}, headers=a).json()["id"]
    assert client.get(f"/chats/{chat_id}", headers=b).status_code == 404


def test_handoff_unknown_target_is_400():
    h = register("h@example.com")
    chat_id = client.post("/sync", json={**CHAT, "external_id": "h1"}, headers=h).json()["id"]
    r = client.post(
        "/handoff",
        json={"conversation_id": chat_id, "target": "unknown"},
        headers=h,
    )
    assert r.status_code == 400


def test_short_chat_handoff_summarizes_zero():
    h = register("s@example.com")
    chat_id = client.post("/sync", json={**CHAT, "external_id": "s1"}, headers=h).json()["id"]
    r = client.post(
        "/handoff",
        json={"conversation_id": chat_id, "target": "claude"},
        headers=h,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["summarized"] == 0
    assert body["kept"] == 2
    assert "chatgpt.com" not in body["url"]
    assert "claude.ai" in body["url"]


def test_seed_chats_endpoint():
    h = register("seed_test@example.com")
    assert len(client.get("/chats", headers=h).json()) == 0
    r = client.post("/chats/seed", headers=h)
    assert r.status_code == 200
    assert r.json()["added"] == 3
    chats = client.get("/chats", headers=h).json()
    assert len(chats) == 3
    sources = {c["source"] for c in chats}
    assert sources == {"chatgpt", "claude", "gemini"}
