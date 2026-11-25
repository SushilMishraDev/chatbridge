import io
import json
import zipfile

from app.services.import_parsers import parse_chatgpt, parse_claude, read_export_json


def test_chatgpt_order_follows_current_node():
    data = [
        {
            "conversation_id": "c1",
            "title": "T",
            "current_node": "b",
            "mapping": {
                "a": {
                    "parent": None,
                    "message": {
                        "author": {"role": "user"},
                        "content": {"parts": ["hi"]},
                    },
                },
                "b": {
                    "parent": "a",
                    "message": {
                        "author": {"role": "assistant"},
                        "content": {"parts": ["hello"]},
                    },
                },
            },
        }
    ]
    out = parse_chatgpt(data)
    assert [m["content"] for m in out[0]["messages"]] == ["hi", "hello"]


def test_claude_roles():
    data = [
        {
            "uuid": "u1",
            "name": "N",
            "chat_messages": [
                {"sender": "human", "text": "q"},
                {"sender": "assistant", "text": "a"},
            ],
        }
    ]
    assert [m["role"] for m in parse_claude(data)[0]["messages"]] == ["user", "assistant"]


def test_zip_without_conversations_json_is_rejected():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("other.txt", "x")
    try:
        read_export_json(buf.getvalue())
        assert False
    except ValueError as e:
        assert "conversations.json" in str(e)


from app.services.import_parsers import parse_pasted_chat


def test_parse_pasted_chat_formats():
    text = """You said:
What is Python?

ChatGPT said:
Python is a programming language.
"""
    msgs = parse_pasted_chat(text)
    assert len(msgs) == 2
    assert msgs[0]["role"] == "user"
    assert msgs[0]["content"] == "What is Python?"
    assert msgs[1]["role"] == "assistant"
    assert msgs[1]["content"] == "Python is a programming language."


def test_paste_import_flow():
    import os
    os.environ["JWT_SECRET"] = "test-secret-test-secret-test-secret"
    os.environ["DATABASE_URL"] = "sqlite:///./test.db"
    from fastapi.testclient import TestClient
    from app.main import app
    from app.database import Base, engine

    Base.metadata.create_all(engine)
    client = TestClient(app)

    reg = client.post("/register", json={"email": "paste_user@example.com", "password": "password123"})
    token = reg.json()["token"]
    h = {"Authorization": f"Bearer {token}"}

    content = """You said:
How do I sort a list in Python?

ChatGPT said:
Use the sorted() function or list.sort().
"""
    # 1. Import first time
    r = client.post("/import/paste", json={"title": "Python Sorting Guide", "content": content}, headers=h)
    assert r.status_code == 200
    res = r.json()
    assert res["status"] == "created"
    assert res["message_count"] == 2
    chat_id = res["id"]

    # 2. Check messages in right order and roles
    c = client.get(f"/chats/{chat_id}", headers=h).json()
    assert c["title"] == "Python Sorting Guide"
    assert len(c["messages"]) == 2
    assert c["messages"][0]["role"] == "user"
    assert c["messages"][1]["role"] == "assistant"

    # 3. Search and find the title
    chats = client.get("/chats", headers=h).json()
    matching = [x for x in chats if "sorting guide" in x["title"].lower()]
    assert len(matching) == 1

    # 4. Duplicate import - must NOT duplicate or append
    r2 = client.post("/import/paste", json={"title": "Python Sorting Guide", "content": content}, headers=h)
    assert r2.status_code == 200
    res2 = r2.json()
    assert res2["status"] == "already_exists"
    assert res2["replaced"] is False

    # Check that messages were not appended
    c2 = client.get(f"/chats/{chat_id}", headers=h).json()
    assert len(c2["messages"]) == 2
