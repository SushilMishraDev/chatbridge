const API = import.meta.env.VITE_API || "http://localhost:8000";

export async function upload(path, file, extra = {}) {
  const form = new FormData();
  form.append("file", file);
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  const token = localStorage.getItem("token");
  const res = await fetch(API + path, {
    method: "POST",
    headers: token ? { Authorization: "Bearer " + token } : {},
    body: form,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || res.status);
  return res.json();
}
