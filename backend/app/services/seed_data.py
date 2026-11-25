import os
from sqlalchemy.orm import Session
from ..models import Conversation, Message, now

DEFAULT_SEEDED_CHATS = [
    {
        "source": "chatgpt",
        "external_id": "seed-chatgpt-arch-01",
        "title": "Full-Stack System Architecture & Caching",
        "messages": [
            {
                "role": "user",
                "content": "How should I design a caching layer for a high-traffic FastAPI application with SQLite and Redis?",
            },
            {
                "role": "assistant",
                "content": "For a high-traffic FastAPI application, you can implement a two-tier caching strategy:\n\n1. In-Memory L1 Cache (Fast): Cache hot query results and sessions locally using an LRU cache or Python's cachetools.\n2. Distributed L2 Cache (Redis): Use Redis for shared state, rate limiting, and invalidation across multiple workers.\n3. Cache Invalidation: Invalidate specific keys on POST/PUT/DELETE operations to ensure fresh data.\n\nHere is a lightweight FastAPI decorator pattern to get started with key generation and automatic serialization.",
            },
            {
                "role": "user",
                "content": "Can you show how to handle graceful fallback if Redis goes down temporarily?",
            },
            {
                "role": "assistant",
                "content": "You can wrap your Redis client in a resilient proxy or try/except block. When Redis raises a ConnectionError or TimeoutError, log a warning and fall through to querying the primary SQLite database directly, with a circuit breaker to avoid hammering Redis during an outage.",
            },
        ],
    },
    {
        "source": "claude",
        "external_id": "seed-claude-worker-02",
        "title": "Async Worker Pools & Error Handling in Python",
        "messages": [
            {
                "role": "user",
                "content": "I'm experiencing intermittent deadlocks with asyncio background tasks under heavy load. How do I structure worker pools safely?",
            },
            {
                "role": "assistant",
                "content": "Asyncio deadlocks typically occur due to unconstrained concurrency, circular task dependencies, or blocking synchronous calls inside the event loop.\n\nRecommended structure:\n1. Use an asyncio.Queue with bounded capacity (maxsize=N) to apply backpressure.\n2. Create a fixed number of worker tasks reading from the queue.\n3. Wrap external network calls with asyncio.wait_for timeouts.\n4. Avoid synchronous file or SQLite operations inside async coroutines; use asyncio.to_thread() where necessary.",
            },
            {
                "role": "user",
                "content": "How do I cleanly cancel worker tasks on application shutdown without losing messages?",
            },
            {
                "role": "assistant",
                "content": "To gracefully shut down:\n1. Stop accepting new items into the queue.\n2. Await queue.join() to let in-flight jobs finish.\n3. Cancel the worker tasks.\n4. Gather them with return_exceptions=True to clean up without raising unhandled CancelledError exceptions.",
            },
        ],
    },
    {
        "source": "gemini",
        "external_id": "seed-gemini-viz-03",
        "title": "Data Visualization & Telemetry Dashboard in Python",
        "messages": [
            {
                "role": "user",
                "content": "What are practical ways to build a telemetry dashboard in Python?",
            },
            {
                "role": "assistant",
                "content": "For a Python dashboard, keep data collection separate from presentation:\n\n1. Store incoming measurements in a database or a bounded queue.\n2. Aggregate readings before rendering so the page stays responsive.\n3. Use server-rendered HTML for simple dashboards, or generate charts with Matplotlib or Plotly.\n4. Cache expensive queries and refresh summaries at a measured interval.",
            },
            {
                "role": "user",
                "content": "Could you provide a Python function that normalizes values for a sparkline?",
            },
            {
                "role": "assistant",
                "content": "```python\ndef normalize(values):\n    if not values:\n        return []\n    low, high = min(values), max(values)\n    span = high - low or 1\n    return [(value - low) / span for value in values]\n```",
            },
        ],
    },
]


def is_test_environment() -> bool:
    db_url = os.environ.get("DATABASE_URL", "")
    return "test.db" in db_url or os.environ.get("TESTING") == "1"


def seed_chats_for_user(db: Session, user_id: int, force: bool = False) -> int:
    if not force and is_test_environment():
        return 0

    added = 0
    for chat_data in DEFAULT_SEEDED_CHATS:
        exists = (
            db.query(Conversation)
            .filter_by(
                user_id=user_id,
                source=chat_data["source"],
                external_id=chat_data["external_id"],
            )
            .first()
        )
        if not exists:
            convo = Conversation(
                user_id=user_id,
                source=chat_data["source"],
                external_id=chat_data["external_id"],
                title=chat_data["title"],
                updated_at=now(),
            )
            db.add(convo)
            db.flush()
            for i, m in enumerate(chat_data["messages"]):
                convo.messages.append(
                    Message(position=i, role=m["role"], content=m["content"])
                )
            added += 1

    if added > 0:
        db.commit()
    return added
