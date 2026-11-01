import { createMockApi } from "./mockAPI";
import { connectLive } from "./live";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

// Set VITE_DEMO=true in .env.local to run on built-in sample data (no server).
export const DEMO = import.meta.env.VITE_DEMO === "true";

export const ROUTES = {
  login: "/token",
  register: "/auth/register",
  disbursements: "/disbursements/", // trailing slash avoids a 307 redirect
  projects: "/projects",
  summary: (title) => `/projects/${encodeURIComponent(title)}/summary`,
  disbursement: (id) => `/disbursements/${id}`,
  password: "/users/change-password",
};
const UPDATE_METHOD = "PATCH";

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function http(path, { method = "GET", body, form, upload, token } = {}) {
  const headers = {};
  let payload;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (upload) {
    payload = upload; // FormData: the browser sets the multipart Content-Type itself
  } else if (form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    payload = new URLSearchParams(form);
  } else if (body) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(API_URL + path, { method, headers, body: payload });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and that the API is running.", 0);
  }

  if (!res.ok) {
    let detail = "";
    try {
      const data = await res.json();
      detail = Array.isArray(data.detail) ? data.detail.map((d) => d.msg).join(" ") : data.detail;
    } catch {
      /* body wasn't JSON */
    }
    throw new ApiError(detail || `Request failed (${res.status}).`, res.status);
  }
  return res.status === 204 ? null : res.json();
}

// When a token stops working, as milliseconds on this computer's clock (measured from when
// it was received, so a computer clock that's off doesn't matter). null if unknown.
export function tokenExpiresAt(token, receivedAt = Date.now()) {
  const p = decodeToken(token || "");
  if (!p?.exp) return null;
  return p.iat ? receivedAt + (p.exp - p.iat) * 1000 : p.exp * 1000;
}

// The backend has no /users/me, so the session info comes from the JWT itself.
function decodeToken(t) {
  try {
    const b64 = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

// `tokenSource` is the token, or a function returning the current one: the app renews the
// token while someone is active, and every call should use the newest.
export function createApi(tokenSource, onUnauthorized) {
  const currentToken = () => (typeof tokenSource === "function" ? tokenSource() : tokenSource);
  if (DEMO) return createMockApi();
  const call = async (path, opts = {}) => {
    try {
      return await http(path, { ...opts, token: currentToken() });
    } catch (e) {
      if (e.status === 401 && currentToken() && onUnauthorized) onUnauthorized(e.message);
      throw e;
    }
  };
  return {
    // Returns { access_token } or, if the account is open on another device,
    // { status: "waiting", challenge_id, secret } (see the two calls below)
    login: (username, password) =>
      http(ROUTES.login, { method: "POST", form: { username, password } }),
    loginChallengeStatus: (id, secret) =>
      http(`/auth/login-challenges/${id}/status`, { method: "POST", body: { secret } }),
    cancelLoginChallenge: (id, secret) =>
      http(`/auth/login-challenges/${id}/cancel`, { method: "POST", body: { secret } }).catch(() => {}),
    // Ends this device's session (best effort; never signs out because of an error)
    endSession: () => {
      const token = currentToken();
      return token ? http("/auth/logout", { method: "POST", token }).catch(() => {}) : Promise.resolve();
    },
    // A fresh sign-in for someone who is still using the app (see hooks/useSessionKeepAlive.js)
    refreshToken: () => call("/auth/refresh", { method: "POST" }),
    // The signed-in device: sign-ins from other devices waiting for an answer
    myLoginChallenges: () => call("/me/login-challenges"),
    allowLogin: (id) => call(`/me/login-challenges/${id}/allow`, { method: "POST" }),
    denyLogin: (id) => call(`/me/login-challenges/${id}/deny`, { method: "POST" }),
    register: (body) => http(ROUTES.register, { method: "POST", body }),
    // Forgot password (no sign-in needed); an admin approves it
    requestPasswordReset: (username, message) =>
      http("/auth/reset-request", { method: "POST", body: { username, message: message || null } }),
    me: async () => {
      const payload = decodeToken(currentToken());
      const expired = payload?.exp && payload.exp * 1000 < Date.now();
      if (!payload?.sub || expired) throw new ApiError("Your session has expired.", 401);
      return {
        username: payload.sub,
        name: payload.name || payload.sub,
        is_superuser: !!payload.is_superuser,
        must_change_password: !!payload.must_change_password,
      };
    },
    
    listProjects: () => call(ROUTES.projects),

    // Lists every project from the backend, then combines their summaries
    // into one flat list of entries for the Voucher Control table.
    // Every active entry with its project title, in one request (it used to be one request
    // per project: 100+ per page load, the main cost found in the load test)
    listDisbursements: () => call(ROUTES.disbursements),

    getSummary: (title) => call(ROUTES.summary(title)),
    // A project's entries as an Excel file: { blob, filename }
    exportProject: async (title) => {
      let res;
      try {
        res = await fetch(`${API_URL}/projects/${encodeURIComponent(title)}/export`, {
          headers: { Authorization: `Bearer ${currentToken()}` },
        });
      } catch {
        throw new ApiError("Can't reach the server. Check your connection and that the API is running.", 0);
      }
      if (!res.ok) {
        if (res.status === 401 && onUnauthorized) onUnauthorized();
        let detail = "";
        try {
          detail = (await res.json()).detail;
        } catch {
          /* not JSON */
        }
        throw new ApiError(detail || `Export failed (${res.status}).`, res.status);
      }
      const match = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "");
      return { blob: await res.blob(), filename: match ? match[1] : `${title}.xlsx` };
    },

    createDisbursement: (body) =>
      call(ROUTES.disbursements, { method: "POST", body }),

    updateDisbursement: (id, body) =>
      call(ROUTES.disbursement(id), { method: UPDATE_METHOD, body }),

    // The backend archives the entry; nothing is ever erased.
    deleteDisbursement: (id) => call(ROUTES.disbursement(id), { method: "DELETE" }),

    createProject: (title) => call(ROUTES.projects, { method: "POST", body: { title } }),
    // Archives the project with all its entries (restorable for 30 days)
    archiveProject: (id) => call(`${ROUTES.projects}/${id}`, { method: "DELETE" }),
    listArchivedProjects: () => call(`${ROUTES.projects}/archived`),
    restoreProject: (id) => call(`${ROUTES.projects}/${id}/restore`, { method: "POST" }),

    changePassword: (body) => call(ROUTES.password, { method: "POST", body }),

    // Requests: normal users ask, admins approve or reject (with an optional note)
    requestDeletion: (id, reason) =>
      call(`/disbursements/${id}/deletion-request`, { method: "POST", body: { reason } }),
    requestEdit: (id, body) =>
      call(`/disbursements/${id}/edit-request`, { method: "POST", body }),
    listMyRequests: () => call("/my-requests"),
    markRequestsSeen: () => call("/my-requests/seen", { method: "POST" }),
    listRequests: (status = "pending") => call(`/deletion-requests?status=${status}`),
    approveRequest: (id, note) =>
      call(`/deletion-requests/${id}/approve`, { method: "POST", body: note ? { note } : undefined }),
    rejectRequest: (id, note) =>
      call(`/deletion-requests/${id}/reject`, { method: "POST", body: note ? { note } : undefined }),

    // Password resets (admins only). approveReset returns the one-time temporary password.
    listResetRequests: (status = "pending") => call(`/password-resets?status=${status}`),
    approveReset: (id, note) =>
      call(`/password-resets/${id}/approve`, { method: "POST", body: note ? { note } : undefined }),
    rejectReset: (id, note) =>
      call(`/password-resets/${id}/reject`, { method: "POST", body: note ? { note } : undefined }),

    // User management (admins only). resetUserPassword returns the one-time temporary password.
    listUsers: () => call("/users"),
    listPendingUsers: () => call("/users/pending"),

    // Own profile: picture and name. Staff name changes wait for an admin.
    getProfile: () => call("/me/profile"),
    uploadAvatar: (blob) => {
      const form = new FormData();
      form.append("file", blob, "avatar.jpg");
      return call("/me/avatar", { method: "PUT", upload: form });
    },
    removeAvatar: () => call("/me/avatar", { method: "DELETE" }),
    // Pictures need the sign-in token, so they're fetched here and shown from a local copy
    avatarBlob: async (userId, version) => {
      const res = await fetch(`${API_URL}/avatars/${userId}?v=${encodeURIComponent(version || "")}`, {
        headers: { Authorization: `Bearer ${currentToken()}` },
      });
      return res.ok ? res.blob() : null;
    },
    changeName: (newName) => call("/me/name", { method: "POST", body: { new_name: newName } }),
    myActivity: (page = 1, size = 20, signins = true) =>
      call(`/me/activity?page=${page}&size=${size}&signins=${signins}`),
    mySecurity: () => call("/me/security"),
    backupStatus: () => call("/backup-status"),
    myStats: () => call("/me/stats"),
    signOutEverywhere: () => call("/me/sign-out-everywhere", { method: "POST" }),
    cancelNameRequest: () => call("/me/name", { method: "DELETE" }),
    listNameRequests: () => call("/name-requests"),
    approveNameRequest: (id, note) =>
      call(`/name-requests/${id}/approve`, { method: "POST", body: note ? { note } : undefined }),
    rejectNameRequest: (id, note) =>
      call(`/name-requests/${id}/reject`, { method: "POST", body: note ? { note } : undefined }),
    approveUser: (id) => call(`/users/${id}/approve`, { method: "POST" }),
    rejectUser: (id) => call(`/users/${id}/reject`, { method: "POST" }),
    updateUser: (id, body) => call(`/users/${id}`, { method: "PATCH", body }),
    resetUserPassword: (id) => call(`/users/${id}/reset-password`, { method: "POST" }),
    deleteUser: (id) => call(`/users/${id}`, { method: "DELETE" }),

    // CSV import (admins only). mode "preview" checks the file; "commit" saves the valid rows.
    importDisbursements: (file, mode = "preview") => {
      const data = new FormData();
      data.append("file", file);
      return call(`/disbursements/import?mode=${mode}`, { method: "POST", upload: data });
    },

    // Assistant: streams the answer; onEvent gets {type: "status" | "delta" | "error" | "done", text}
    chat: async (messages, onEvent, signal) => {
      let res;
      try {
        res = await fetch(`${API_URL}/chat`, {
          method: "POST",
          headers: { Authorization: `Bearer ${currentToken()}`, "Content-Type": "application/json" },
          body: JSON.stringify({ messages }),
          signal,
        });
      } catch (e) {
        if (e.name === "AbortError") throw e;
        throw new ApiError("Can't reach the server. Check your connection and that the API is running.", 0);
      }
      if (!res.ok) {
        if (res.status === 401 && onUnauthorized) onUnauthorized();
        let detail = "";
        try {
          const data = await res.json();
          detail = Array.isArray(data.detail) ? data.detail.map((d) => d.msg).join(" ") : data.detail;
        } catch {
          /* body wasn't JSON */
        }
        throw new ApiError(detail || `Request failed (${res.status}).`, res.status);
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let cut;
        while ((cut = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, cut).trim();
          buffer = buffer.slice(cut + 1);
          if (!line) continue;
          let event;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          onEvent(event);
        }
      }
    },

    // Live updates: returns a function that closes the connection
    connectLive: (handlers) => connectLive(`${API_URL}/live`, currentToken, handlers),

    // Activity Log (admins only)
    listActivity: (params = {}) => {
      const query = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== "" && v != null)
      );
      return call(`/activity-logs?${query}`);
    },
    listArchived: () => call("/disbursements/archived"),
    restoreDisbursement: (id) => call(`/disbursements/${id}/restore`, { method: "POST" }),
  };
}