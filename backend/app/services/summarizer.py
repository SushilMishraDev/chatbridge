import os

import httpx

from .context_builder import to_transcript

FALLBACK_CHARS = 1200


def summarize(dropped: list[dict]) -> str:
    text = to_transcript(dropped)
    if os.environ.get("ANTHROPIC_API_KEY"):
        try:
            return ai_summary(text)
        except Exception:
            pass  # fall through to the simple version
    return text[:FALLBACK_CHARS] + (" ..." if len(text) > FALLBACK_CHARS else "")


def ai_summary(text: str) -> str:
    """Call Anthropic if a key is set. Keep under 250 words."""
    key = os.environ["ANTHROPIC_API_KEY"]
    model = os.environ.get("SUMMARY_MODEL", "claude-sonnet-4-5")
    res = httpx.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json={
            "model": model,
            "max_tokens": 400,
            "messages": [
                {
                    "role": "user",
                    "content": (
                        "Summarize this conversation in under 250 words. "
                        "Keep decisions, facts, names, code details and open questions.\n\n"
                        + text[:20000]
                    ),
                }
            ],
        },
        timeout=30,
    )
    res.raise_for_status()
    return res.json()["content"][0]["text"]
