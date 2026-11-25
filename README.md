# ChatBridge

ChatBridge saves AI conversations so you can review, export, and continue them with another assistant. It does **not** bypass usage limits or send messages on your behalf.

The application is implemented in Python with FastAPI, SQLAlchemy, and server-rendered HTML templates. It contains no client-side JavaScript. Browser-extension capture has been removed; import conversations from ChatGPT, Claude, or a ChatBridge backup, or paste a transcript.

## Run locally

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
copy ..\.env.example ..\.env
uvicorn app.main:app --reload
```

Open http://127.0.0.1:8000 to sign in by email verification code. API documentation is available at http://127.0.0.1:8000/docs.

If SMTP is not configured, the development verification code is written to the server log. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and `SMTP_PASSWORD` to send codes by email.

## Tests

```powershell
cd backend
.\.venv\Scripts\activate
pytest
```

## Deployment

Build and run the Python-only container with Docker:

```powershell
docker build -t chatbridge .
docker run -p 8000:8000 -e JWT_SECRET="replace-with-a-long-random-secret" chatbridge
```

Set `DATABASE_URL` to use a persistent or managed database in production.
