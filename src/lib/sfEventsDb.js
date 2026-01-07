// src/lib/sfEventsDb.js

const DB_NAME = "fs-sf-events";
const DB_VERSION = 1;
const STORE_NAME = "sfEvents";

// --- UUID helper (iOS WKWebView-safe) ---
function safeRandomUUID() {
  try {
    const c = globalThis?.crypto;

    if (c && typeof c.randomUUID === "function") {
      return c.randomUUID();
    }

    if (c && typeof c.getRandomValues === "function") {
      const buf = new Uint8Array(16);
      c.getRandomValues(buf);

      buf[6] = (buf[6] & 0x0f) | 0x40;
      buf[8] = (buf[8] & 0x3f) | 0x80;

      const hex = Array.from(buf, (b) => b.toString(16).padStart(2, "0"));
      return (
        hex.slice(0, 4).join("") +
        "-" +
        hex.slice(4, 6).join("") +
        "-" +
        hex.slice(6, 8).join("") +
        "-" +
        hex.slice(8, 10).join("") +
        "-" +
        hex.slice(10, 16).join("")
      );
    }
  } catch {}

  return (
    "id-" +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2) +
    "-" +
    Math.random().toString(36).slice(2)
  );
}

// --- Internal: open DB and ensure store exists ---
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Failed to open sfEvents DB"));
  });
}

function resetDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || new Error("Failed to delete sfEvents DB"));
    req.onblocked = () => {
      console.warn("sfEvents DB delete blocked; may require page reload.");
      resolve();
    };
  });
}

/**
 * Helper to run a function with an IDBObjectStore.
 * Automatically recovers if the store is missing (NotFoundError).
 */
async function withStore(mode, fn) {
  let db = await openDb();

  try {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const result = await fn(store);

    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
    });

    return result;
  } catch (err) {
    if (err && err.name === "NotFoundError") {
      console.warn("[sfEventsDb] Store missing; resetting sf-events DB and recreating.");
      db.close();
      await resetDb();
      db = await openDb();

      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      const result = await fn(store);

      await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
      });

      return result;
    }

    throw err;
  }
}

// --- Public API ---

export async function queueSfEvent(event) {
  const id = safeRandomUUID();

  const record = {
    id,
    ...event,
    status: "PENDING",
    createdAt: event.occurredAt || new Date().toISOString(),
  };

  await withStore("readwrite", (store) => {
    store.put(record);
  });

  return record;
}

export async function getPendingSfEvents() {
  return withStore("readonly", (store) => {
    return new Promise((resolve, reject) => {
      const index = store.index("status");
      const request = index.getAll("PENDING");
      request.onsuccess = () => {
        const results = request.result || [];
        results.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        resolve(results);
      };
      request.onerror = () =>
        reject(request.error || new Error("Failed to get pending SF events"));
    });
  });
}

export async function markSfEventCompleted(id) {
  return withStore("readwrite", (store) => {
    return new Promise((resolve, reject) => {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const rec = getReq.result;
        if (!rec) return resolve();
        rec.status = "COMPLETED";
        rec.completedAt = new Date().toISOString();
        store.put(rec);
        resolve();
      };
      getReq.onerror = () =>
        reject(getReq.error || new Error("Failed to read SF event"));
    });
  });
}

/**
 * NEW: Hard delete (best for permanently bad events that will never succeed).
 */
export async function deleteSfEvent(id) {
  return withStore("readwrite", (store) => {
    return new Promise((resolve, reject) => {
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () =>
        reject(req.error || new Error("Failed to delete SF event"));
    });
  });
}

/**
 * Optional: mark as FAILED (kept in DB, but not pending).
 */
export async function markSfEventFailed(id, error) {
  return withStore("readwrite", (store) => {
    return new Promise((resolve, reject) => {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const rec = getReq.result;
        if (!rec) return resolve();
        rec.status = "FAILED";
        rec.failedAt = new Date().toISOString();
        rec.lastError = error ? JSON.stringify(error).slice(0, 2000) : "";
        store.put(rec);
        resolve();
      };
      getReq.onerror = () =>
        reject(getReq.error || new Error("Failed to read SF event"));
    });
  });
}

export async function clearAllSfEvents() {
  return withStore("readwrite", (store) => {
    store.clear();
  });
}

/**
 * NEW: wipe only pending items (nice “Reset queue” button behavior).
 */
export async function clearPendingSfEvents() {
  const pending = await getPendingSfEvents();
  for (const evt of pending) {
    try {
      await deleteSfEvent(evt.id);
    } catch (e) {
      console.warn("[sfEventsDb] Failed deleting pending event", evt?.id, e);
    }
  }
}
