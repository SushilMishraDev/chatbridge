# ChatBridge Deployment Guide

ChatBridge is a Python-only FastAPI application. The same service provides the server-rendered web interface and JSON API; no JavaScript build step is required.

## Docker

```powershell
docker build -t chatbridge .
docker run -p 8000:8000 `
  -e JWT_SECRET="replace-with-a-long-random-secret" `
  -e DATABASE_URL="sqlite:////data/chatbridge.db" `
  -v "${PWD}/data:/data" `
  chatbridge
```

Open `http://localhost:8000`. Configure a persistent database volume or managed database before using the service for important conversations.

## Render

1. Connect the GitHub repository to a new Render Web Service.
2. Select Docker as the runtime and use the repository's `Dockerfile`.
3. Configure `JWT_SECRET` as a strong secret and `DATABASE_URL` for persistent storage.
4. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and `SMTP_PASSWORD` if email verification codes should be delivered by email.

## Local run

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Without SMTP settings, verification codes are written to the server log for local development.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PORT` | Uvicorn listening port; defaults to `8000`. |
| `JWT_SECRET` | Secret used to sign login tokens. Set a strong value in production. |
| `DATABASE_URL` | SQLAlchemy database URL. Defaults to a SQLite file. |
| `SMTP_HOST`, `SMTP_PORT` | SMTP server and port for verification email. |
| `SMTP_USER`, `SMTP_PASSWORD` | SMTP credentials for verification email. |
| `ANTHROPIC_API_KEY` | Optional key for conversation summarization during handoff. |

## Conversation capture

This version has no browser extension or automatic capture. Users can preview and select conversations from ChatGPT, Claude, or ChatBridge exports, or paste a transcript from the Import page. Handoff prompts are displayed for manual copy and paste; ChatBridge never sends a message to another assistant.
