import re

CHARS_PER_TOKEN = 4  # rough rule for English text

# Regex to detect base64 data URLs so they don't blow up token estimation or text prompts
DATA_URL_RE = re.compile(r"!\[([^\]]*)\]\(data:image\/[^;]+;base64,[A-Za-z0-9+/=]+\)")


def strip_handoff_boilerplate(text: str) -> str:
    """Strips recursive or nested handoff banners so prompts never explode in size."""
    if not text or "=== UNEDITABLE" not in text:
        return text
    clean = re.sub(
        r"=== UNEDITABLE PREVIOUS CONVERSATION HISTORY.*?--- PREVIOUS CONVERSATION TRANSCRIPT ---\s*",
        "",
        text,
        flags=re.DOTALL,
    )
    while "=== UNEDITABLE" in clean:
        clean = re.sub(
            r"=== UNEDITABLE PREVIOUS CONVERSATION HISTORY.*?--- PREVIOUS CONVERSATION TRANSCRIPT ---\s*",
            "",
            clean,
            flags=re.DOTALL,
        )
    clean = re.sub(
        r"--- (?:END OF CONVERSATION|NEXT USER INSTRUCTION) ---.*?(?:Please continue|My next message / question:\s*)",
        "",
        clean,
        flags=re.DOTALL,
    )
    return clean.strip() or text


def clean_content_for_prompt(text: str) -> str:
    """Replaces raw inline base64 image bytes with readable image references for the AI prompt and strips recursive boilerplate."""
    if not text:
        return ""
    text = strip_handoff_boilerplate(text)
    def _replace_img(match):
        alt = match.group(1).strip() or "Image"
        return f"[Image Attachment: {alt}]"
    return DATA_URL_RE.sub(_replace_img, text)


def estimate_tokens(text: str) -> int:
    clean = clean_content_for_prompt(text)
    return max(1, len(clean) // CHARS_PER_TOKEN)


def build_context(messages: list[dict], max_tokens: int = 2500):
    """Keep the newest messages that fit; return (kept, dropped)."""
    kept, used = [], 0
    for m in reversed(messages):
        cost = estimate_tokens(m["content"])
        if kept and used + cost > max_tokens:
            break  # always keep at least the newest message
        kept.append(m)
        used += cost
    kept.reverse()
    dropped = messages[: len(messages) - len(kept)]
    return kept, dropped


def to_transcript(messages: list[dict]) -> str:
    names = {"user": "User", "assistant": "Assistant"}
    lines = []
    for m in messages:
        role_name = names.get(m["role"], m["role"].capitalize())
        content = clean_content_for_prompt(m["content"])
        lines.append(f"{role_name}: {content}")
    return "\n\n".join(lines)


def make_handoff_prompt(
    kept,
    summary: str | None,
    next_message: str | None,
    source_platform: str | None = None,
    target_platform: str | None = None,
) -> str:
    src = (source_platform or "").strip().lower()
    tgt = (target_platform or "").strip().lower()

    if src and tgt and src == tgt:
        context_line = (
            f"This is a continuation of our earlier {src.upper()} conversation in a fresh session "
            f"because the previous chat reached its limit."
        )
    elif src and tgt:
        context_line = f"I was previously chatting on {src.upper()} and am continuing our conversation here on {tgt.upper()}."
    else:
        context_line = "This is a continuation of our previous conversation."

    parts = [
        "=== UNEDITABLE PREVIOUS CONVERSATION HISTORY (READ-ONLY CONTEXT) ===",
        context_line,
        "Below is our complete earlier conversation, preserved verbatim with all image references.",
        "Read it, remember it, and continue directly from where we stopped.",
        "",
    ]
    if summary:
        parts += ["--- SUMMARY OF EARLIER PART ---", summary, "--- END OF SUMMARY ---", ""]
    parts += ["--- PREVIOUS CONVERSATION TRANSCRIPT ---", to_transcript(kept), "--- END OF CONVERSATION ---", ""]
    if next_message:
        parts.append(f"My next message / question:\n{next_message}")
    else:
        parts.append("Please continue our conversation from where we stopped, or reply with one line confirming you are ready.")
    return "\n".join(parts)
