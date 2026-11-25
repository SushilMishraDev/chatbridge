# ChatBridge

Save AI chats and continue them on another assistant when one hits its usage limit. ChatBridge does **not** bypass limits and never presses Send.

## Parts

- **Website** (React): register, browse chats, continue with a copied handoff prompt, import/export
- **API** (FastAPI + SQLite): auth, sync, chats, handoff, import, export
- **Chrome extension**: capture chats on ChatGPT / Claude / Gemini and fill the next AI’s box (you still send)

## Run locally

### 1. Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
copy ..\.env.example ..\.env
uvicorn app.main:app --reload
```

API docs: http://127.0.0.1:8000/docs

### 2. Website

```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 — register an account, click **Add sample chat**, then **Continue**.

### 3. Extension (optional)

1. Open `chrome://extensions`
2. Turn on Developer mode
3. Load unpacked → choose the `extension` folder
4. Log in with the same account as the website

## Tests

```powershell
cd backend
.\.venv\Scripts\activate
pytest
```
