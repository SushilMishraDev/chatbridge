# ChatBridge project notes

## Purpose
Save AI chats and continue them on another AI. Never bypass limits or send messages on a user's behalf.

## Stack
Python, FastAPI, SQLAlchemy, SQLite, and server-rendered HTML templates. The web interface has no client-side JavaScript.

## Rules
- Filter every conversation query by user; other users receive 404.
- Never replace a conversation with a shorter copy.
- Keep secrets in environment variables.
- Conversation capture is manual through imports or pasted transcripts; there is no browser extension.

## Features
- Email verification sign-in
- Search, filter, and sort saved conversations
- Import ChatGPT, Claude, and ChatBridge exports, or paste a transcript
- Export conversations as Markdown, plain text, or JSON
- Prepare a handoff prompt to copy and paste into another assistant
