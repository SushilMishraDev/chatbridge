import hashlib
import io
import json
import re
import zipfile

MAX_UPLOAD_BYTES = 100 * 1024 * 1024
MAX_JSON_BYTES = 500 * 1024 * 1024


class ImportError_(ValueError):
    """Friendly import failure shown to the user."""


def read_export_json(raw: bytes, filename: str = ""):
    if len(raw) > MAX_UPLOAD_BYTES:
        raise ImportError_("File is larger than 100 MB.")
    name = (filename or "").lower()
    looks_like_zip = name.endswith(".zip") or raw[:2] == b"PK"
    if looks_like_zip:
        try:
            zf = zipfile.ZipFile(io.BytesIO(raw))
        except zipfile.BadZipFile as e:
            raise ImportError_("That zip file could not be opened.") from e
        json_name = None
        for entry in zf.namelist():
            if entry.replace("\\", "/").split("/")[-1] == "conversations.json":
                json_name = entry
                break
        if not json_name:
            raise ValueError("No conversations.json found in the zip.")
        info = zf.getinfo(json_name)
        if info.file_size > MAX_JSON_BYTES:
            raise ImportError_("The JSON inside the zip is larger than 500 MB.")
        with zf.open(json_name) as handle:
            payload = handle.read(MAX_JSON_BYTES + 1)
        if len(payload) > MAX_JSON_BYTES:
            raise ImportError_("The JSON inside the zip is larger than 500 MB.")
        try:
            return json.loads(payload.decode("utf-8"))
        except Exception as e:
            raise ImportError_("conversations.json is not valid JSON.") from e
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception as e:
        raise ImportError_("That file is not valid JSON.") from e


def parse_chatgpt(data) -> list[dict]:
    if isinstance(data, dict):
        data = data.get("conversations", data)
    if not isinstance(data, list):
        raise ImportError_("This does not look like a ChatGPT export.")
    out = []
    for conv in data:
        mapping = conv.get("mapping") or {}
        node_id = conv.get("current_node")
        chain = []
        seen: set[str] = set()
        while node_id and node_id not in seen:
            seen.add(node_id)
            node = mapping.get(node_id) or {}
            chain.append(node)
            node_id = node.get("parent")
        chain.reverse()
        messages = []
        for node in chain:
            msg = node.get("message") or {}
            author = (msg.get("author") or {}).get("role")
            if author not in ("user", "assistant"):
                continue
            content = msg.get("content") or {}
            parts = content.get("parts") or []
            text = "\n".join(p for p in parts if isinstance(p, str)).strip()
            if text:
                messages.append({"role": author, "content": text})
        external_id = conv.get("conversation_id") or conv.get("id")
        if external_id and messages:
            out.append(
                {
                    "source": "chatgpt",
                    "external_id": str(external_id),
                    "title": (conv.get("title") or "Untitled")[:200],
                    "messages": messages,
                }
            )
    return out


def parse_claude(data) -> list[dict]:
    if not isinstance(data, list):
        raise ImportError_("This does not look like a Claude export.")
    out = []
    for conv in data:
        msgs = []
        for item in conv.get("chat_messages") or []:
            sender = item.get("sender")
            if sender == "human":
                role = "user"
            elif sender == "assistant":
                role = "assistant"
            else:
                continue
            text = (item.get("text") or "").strip()
            if text:
                msgs.append({"role": role, "content": text})
        if msgs and conv.get("uuid"):
            out.append(
                {
                    "source": "claude",
                    "external_id": str(conv["uuid"]),
                    "title": (conv.get("name") or "Untitled")[:200],
                    "messages": msgs,
                }
            )
    return out


def parse_chatbridge(data) -> list[dict]:
    if not isinstance(data, dict) or "conversations" not in data:
        raise ImportError_("This is not a ChatBridge export file.")
    out = []
    for conv in data["conversations"]:
        msgs = [
            m
            for m in conv.get("messages", [])
            if m.get("role") in ("user", "assistant") and m.get("content")
        ]
        if conv.get("external_id") and msgs:
            out.append(
                {
                    "source": conv.get("source", "chatbridge"),
                    "external_id": str(conv["external_id"]),
                    "title": (conv.get("title") or "Untitled")[:200],
                    "messages": msgs,
                }
            )
    return out


def make_pasted_external_id(title: str) -> str:
    norm = title.strip().lower()
    h = hashlib.sha256(norm.encode("utf-8")).hexdigest()[:16]
    return f"pasted-{h}"


def parse_pasted_chat(text: str) -> list[dict]:
    """Parse a pasted conversation transcript or JSON into structured messages."""
    text = (text or "").strip()
    if not text:
        return []

    # 1. Check if the input is a JSON array
    if (text.startswith("[") and text.endswith("]")) or (text.startswith("{") and text.endswith("}")):
        try:
            parsed = json.loads(text)
            items = parsed if isinstance(parsed, list) else parsed.get("messages", [])
            msgs = []
            for m in items:
                if isinstance(m, dict) and "content" in m:
                    r = str(m.get("role", "user")).lower()
                    role = "assistant" if any(k in r for k in ("assistant", "ai", "chatgpt", "model")) else "user"
                    c = str(m["content"]).strip()
                    if c:
                        msgs.append({"role": role, "content": c})
            if msgs:
                return msgs
        except Exception:
            pass

    # 2. Match role headers like 'User:', 'ChatGPT:', 'You said:', 'ChatGPT said:', '**User:**'
    pattern = re.compile(
        r'(?:^|\n)(?:\*{1,2}|#{1,3}\s*)?(You said|ChatGPT said|User said|ChatGPT|User|Human|Assistant|AI|Me)(?:\*{1,2})?\s*[:：]?(?:\*{1,2})?\s*\n?',
        re.IGNORECASE,
    )
    matches = list(pattern.finditer(text))
    if matches:
        messages = []
        for i, match in enumerate(matches):
            raw_speaker = match.group(1).lower()
            if any(k in raw_speaker for k in ("chatgpt", "assistant", "model", "bot")) or raw_speaker == "ai":
                role = "assistant"
            else:
                role = "user"
            start = match.end()
            end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
            content = text[start:end].strip()
            content = re.sub(r"^\*+\s*", "", content)
            if content:
                messages.append({"role": role, "content": content})
        if messages:
            return messages

    # 3. Fallback: non-empty text as a single user prompt
    return [{"role": "user", "content": text}]


PARSERS = {
    "chatgpt": parse_chatgpt,
    "claude": parse_claude,
    "chatbridge": parse_chatbridge,
}


def parse_export(platform: str, raw: bytes, filename: str = "") -> list[dict]:
    parser = PARSERS.get(platform)
    if parser is None:
        raise ImportError_("Unknown platform. Use chatgpt, claude or chatbridge.")
    data = read_export_json(raw, filename)
    return parser(data)
