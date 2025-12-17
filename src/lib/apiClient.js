// src/lib/apiClient.js

const API_BASE = "https://99f8idw2h9.execute-api.us-east-1.amazonaws.com";

function authHeaders(idToken) {
  return idToken
    ? {
        Authorization: `Bearer ${idToken}`,
      }
    : {};
}

export async function getUploadUrl(idToken, body) {
  const res = await fetch(`${API_BASE}/getUploadUrl`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(idToken),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `getUploadUrl failed: ${res.status} ${res.statusText} – ${text}`
    );
  }

  return res.json(); // { uploadUrl, s3Key, fileKey, uploader, ... }
}

export async function getPlaybackUrl(idToken, body) {
  const res = await fetch(`${API_BASE}/getPlaybackUrl`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(idToken),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `getPlaybackUrl failed: ${res.status} ${res.statusText} – ${text}`
    );
  }

  return res.json(); // { playbackUrl }
}

export async function listRecordings(idToken, params = {}) {
  const url = new URL(`${API_BASE}/recordings`, window.location.origin);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      ...authHeaders(idToken),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `list recordings failed: ${res.status} ${res.statusText} – ${text}`
    );
  }

  return res.json(); // { items: [...] }
}

// src/lib/apiClient.js (add at bottom)

export async function sendStatusEvent(idToken, event) {
  const res = await fetch(`${API_BASE}/sfStatusEvents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify(event),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `sendStatusEvent failed: ${res.status} ${res.statusText} – ${text}`
    );
  }

  // adjust as needed; this assumes Lambda returns JSON
  return res.json().catch(() => ({}));
}
