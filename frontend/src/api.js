const API = import.meta.env.VITE_API || "http://localhost:8000";

export async function api(path, options = {}) {
  const token = localStorage.getItem("token");
  const res = await fetch(API + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(options.headers || {}),
    },
  });

  // Only redirect to /login on 401 for authenticated endpoints (not /login or /register)
  if (res.status === 401 && path !== "/login" && path !== "/register") {
    localStorage.removeItem("token");
    if (window.location.pathname !== "/login") {
      window.location.href = "/login";
    }
    throw new Error("Session expired. Please log in again.");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const d = body.detail;
    const msg = Array.isArray(d)
      ? d.map((x) => x.msg || JSON.stringify(x)).join("; ")
      : d || ("Request failed with status " + res.status);
    throw new Error(msg);
  }
  return res.json();
}
