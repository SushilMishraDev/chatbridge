import { useState } from "react";
import { Link } from "react-router-dom";
import { upload } from "../upload";

export default function ImportPage() {
  const [platform, setPlatform] = useState("chatgpt");
  const [file, setFile] = useState(null);
  const [items, setItems] = useState([]);
  const [picked, setPicked] = useState(new Set());
  const [msg, setMsg] = useState("");

  async function preview() {
    setMsg("Reading file...");
    try {
      const list = await upload(`/import/${platform}/preview`, file);
      setItems(list);
      setPicked(new Set(list.map((i) => i.external_id)));
      setMsg(`${list.length} chats found.`);
    } catch (e) {
      setMsg("Could not read the file: " + e.message);
    }
  }

  async function doImport() {
    if (picked.size === 0) {
      setMsg("Tick at least one chat.");
      return;
    }
    setMsg("Importing...");
    try {
      const out = await upload(`/import/${platform}`, file, {
        selected: JSON.stringify([...picked]),
      });
      setMsg(`Imported ${out.imported}, skipped ${out.skipped} (already saved).`);
    } catch (e) {
      setMsg("Import failed: " + e.message);
    }
  }

  function toggle(id) {
    const next = new Set(picked);
    next.has(id) ? next.delete(id) : next.add(id);
    setPicked(next);
  }

  return (
    <div className="shell">
      <div className="topbar">
        <Link className="brand" to="/">
          <span className="wordmark">ChatBridge</span>
        </Link>
        <div className="nav">
          <Link to="/">All chats</Link>
        </div>
      </div>
      <div className="card stack">
        <h2 style={{ margin: 0, fontFamily: "Fraunces, Georgia, serif" }}>Import old chats</h2>
        <p className="meta">
          Export your data from the AI site, then upload the .zip or conversations.json.
          ChatBridge only stores text. Re-importing never replaces a longer saved copy.
        </p>
        <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
          <option value="chatgpt">ChatGPT</option>
          <option value="claude">Claude</option>
          <option value="chatbridge">ChatBridge backup</option>
        </select>
        <input
          type="file"
          accept=".zip,.json"
          onChange={(e) => setFile(e.target.files[0])}
        />
        <button className="ghost" disabled={!file} onClick={preview}>Preview</button>
        <ul>
          {items.map((i) => (
            <li key={i.external_id}>
              <label>
                <input
                  type="checkbox"
                  checked={picked.has(i.external_id)}
                  onChange={() => toggle(i.external_id)}
                />
                {i.title} ({i.messages} messages)
              </label>
            </li>
          ))}
        </ul>
        {items.length > 0 && (
          <button className="btn" onClick={doImport} disabled={picked.size === 0}>
            Import selected
          </button>
        )}
        <p>{msg}</p>
      </div>
    </div>
  );
}
