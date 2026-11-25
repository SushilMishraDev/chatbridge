const API = import.meta.env.VITE_API || "http://localhost:8000";

export async function download(path, filename) {
  const res = await fetch(API + path, {
    headers: { Authorization: "Bearer " + localStorage.getItem("token") },
  });
  if (!res.ok) throw new Error(res.status);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
