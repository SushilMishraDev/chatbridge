import json
import os
import uuid

os.environ["JWT_SECRET"] = "test-secret-test-secret-test-secret"
os.environ["DATABASE_URL"] = "sqlite:///./test.db"
os.environ["TESTING"] = "1"

from fastapi.testclient import TestClient

from app.database import Base, engine
from app.main import app
from app.routes import auth


def test_python_rendered_login_import_handoff_and_export(monkeypatch):
    Base.metadata.create_all(engine)
    client = TestClient(app)
    email = f"web-{uuid.uuid4().hex}@example.com"

    home = client.get("/", follow_redirects=False)
    assert home.status_code == 303
    assert home.headers["location"] == "/ui"
    assert client.get("/static/styles.css").status_code == 200

    login_page = client.get("/login")
    assert login_page.status_code == 200
    assert "Send verification code" in login_page.text
    assert "<script" not in login_page.text.lower()

    monkeypatch.setattr(auth, "send_email_otp", lambda _email, _code: True)
    requested = client.post("/ui/request-otp", data={"email": email})
    assert requested.status_code == 200
    assert "Verify and sign in" in requested.text
    assert auth.otp_cache[email]["code"] not in requested.text

    code = auth.otp_cache[email]["code"]
    verified = client.post(
        "/ui/verify-otp",
        data={"email": email, "code": code},
        follow_redirects=False,
    )
    assert verified.status_code == 303
    assert client.cookies.get("chatbridge_token")
    assert "Sign out" in client.get("/ui/import").text

    imported = client.post(
        "/ui/import/paste",
        data={
            "title": "Python web handoff",
            "source": "chatgpt",
            "content": "You said:\nCan you help?\n\nChatGPT said:\nYes, I can help.",
        },
        follow_redirects=False,
    )
    assert imported.status_code == 303

    backup = {
        "conversations": [
            {
                "source": "chatbridge",
                "external_id": "upload-test-1",
                "title": "Uploaded Python chat",
                "messages": [
                    {"role": "user", "content": "Upload test"},
                    {"role": "assistant", "content": "Saved"},
                ],
            }
        ]
    }
    preview = client.post(
        "/ui/import/preview",
        data={"platform": "chatbridge"},
        files={
            "file": (
                "backup.json",
                json.dumps(backup).encode("utf-8"),
                "application/json",
            )
        },
    )
    assert preview.status_code == 200
    assert "Uploaded Python chat" in preview.text
    assert "<script" not in preview.text.lower()

    uploaded = client.post(
        "/ui/import/file",
        data={"platform": "chatbridge", "selected": ["upload-test-1"]},
        files={
            "file": (
                "backup.json",
                json.dumps(backup).encode("utf-8"),
                "application/json",
            )
        },
        follow_redirects=False,
    )
    assert uploaded.status_code == 303

    dashboard = client.get("/ui?q=Python")
    assert dashboard.status_code == 200
    assert "Python web handoff" in dashboard.text
    assert "Uploaded Python chat" in dashboard.text
    assert "<script" not in dashboard.text.lower()

    saved_chats = client.get(
        "/chats",
        headers={"Authorization": f"Bearer {client.cookies.get('chatbridge_token')}"},
    ).json()
    chat_id = next(chat["id"] for chat in saved_chats if chat["title"] == "Python web handoff")
    handoff = client.post(
        f"/ui/chats/{chat_id}/handoff",
        data={"target": "claude", "next_message": "Continue with the answer."},
    )
    assert handoff.status_code == 200
    assert "Select and copy this prompt" in handoff.text
    assert "claude.ai/new" in handoff.text

    exported = client.get(f"/ui/chats/{chat_id}/export?format=txt")
    assert exported.status_code == 200
    assert "Can you help?" in exported.text

    deleted = client.post(f"/ui/chats/{chat_id}/delete", follow_redirects=False)
    assert deleted.status_code == 303

    logged_out = client.post("/ui/logout", follow_redirects=False)
    assert logged_out.status_code == 303
    assert client.get("/ui", follow_redirects=False).headers["location"] == "/login"
