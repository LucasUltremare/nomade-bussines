/* ══════════════════════════════════
   API client — wrapper sobre fetch
   ══════════════════════════════════ */

// O painel é servido pelo ai-service (PAINEL_URL) — a API do
// server principal chega pelo proxy /hq (o /api cru desse host é do ai-service).
const API = "/hq";

export const api = {
  token: () => localStorage.getItem("nomade_token"),
  setToken: (t) => localStorage.setItem("nomade_token", t),
  clear: () => localStorage.removeItem("nomade_token"),
  async req(path, opts = {}) {
    const r = await fetch(`${API}${path}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${api.token()}`,
        ...(opts.headers || {}),
      },
    });
    if (r.status === 401) { api.clear(); window.location.reload(); return; }
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  get: (p) => api.req(p),
  post: (p, body) => api.req(p, { method: "POST", body: JSON.stringify(body) }),
  patch: (p, body) => api.req(p, { method: "PATCH", body: JSON.stringify(body) }),
  put: (p, body) => api.req(p, { method: "PUT", body: JSON.stringify(body) }),
  del: (p) => api.req(p, { method: "DELETE" }),
};

export { API };
