# ChatBridge project notes

## Purpose
Save AI chats and continue them on another AI. Never bypass limits.

## Stack
Chrome MV3 extension, FastAPI, SQLAlchemy (SQLite), React/Vite.

## Rules
- Filter every query by user; other users get 404.
- Never replace a conversation with a shorter copy.
- Injector never presses Send.
- Secrets only in environment variables.

## Done
- Database models, auth, sync, chats, handoff
- Import (ChatGPT, Claude, ChatBridge backup) and export
- React web app: login, dashboard, chat, continue, import
- Chrome extension: capture, popup, injector with clipboard and dispatchEvent fallback
- Robust hostname matching & selectors for ChatGPT, Claude, and Gemini
- Improved popup UI with clear login errors, active account indicator, and logout support
- All backend tests passing (7/7 in test_import and test_sync)

## Known issues / Next steps
- Verify selectors live against the latest frontend changes of ChatGPT, Claude, and Gemini
- Summariser uses a text fallback unless ANTHROPIC_API_KEY is set (support Gemini/OpenAI keys as options)
- ML role classifier is not built
