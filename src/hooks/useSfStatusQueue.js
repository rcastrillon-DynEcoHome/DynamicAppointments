// src/hooks/useSfStatusQueue.js
import {
  queueSfEvent,
  getPendingSfEvents,
  markSfEventCompleted,
} from "../lib/sfEventsDb.js";

const API_BASE = "https://99f8idw2h9.execute-api.us-east-1.amazonaws.com";

async function sendEventsBatchToSalesforce(idToken, events) {
  if (!events || !events.length) return;

  const body = {
    events: events.map((e) => ({
      appointmentId: e.appointmentId,
      eventType: e.eventType,
      statusValue: e.statusValue,
      occurredAt: e.occurredAt,
      userSub: e.userSub,
      userEmail: e.userEmail,
      userName: e.userName,
    })),
  };

  const url = `${API_BASE}/sfStatusEvents`;
  console.log("[SF QUEUE] POST", url, { count: events.length });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
  });

  const rawText = await res.text().catch(() => "");

  if (!res.ok) {
    throw new Error(
      `sfStatusEvents failed: ${res.status} ${res.statusText} – ${rawText}`
    );
  }

  // Lambda returns JSON like: { processed, successCount, failedCount, results:[...] }
  let data = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = null;
  }

  if (data) {
    console.log("[SF QUEUE] Sync response:", data);

    const failedCount = Number(data.failedCount || 0);
    if (failedCount > 0) {
      const firstErr = (data.results || []).find(
        (r) => r && r.success === false
      );
      const msg = firstErr
        ? JSON.stringify(firstErr.error || firstErr)
        : "Unknown Salesforce update failure";
      throw new Error(`Salesforce update failed: ${msg}`);
    }
  } else {
    console.log("[SF QUEUE] Sync response (non-JSON):", rawText);
  }
}

export function useSfStatusQueue({ idToken, user }) {
  async function syncPending() {
    if (!idToken || !user) {
      console.debug("[SF QUEUE] Skipping sync: no idToken or user.", {
        hasToken: !!idToken,
        hasUser: !!user,
      });
      return;
    }

    if (!navigator.onLine) {
      console.debug("[SF QUEUE] Skipping sync: offline.");
      return;
    }

    const pending = await getPendingSfEvents();
    if (!pending.length) return;

    console.log("[SF QUEUE] syncing pending events", {
      count: pending.length,
      first: pending[0],
    });

    await sendEventsBatchToSalesforce(idToken, pending);

    for (const evt of pending) {
      try {
        await markSfEventCompleted(evt.id);
      } catch (e) {
        console.warn("[SF QUEUE] Failed to mark completed:", evt.id, e);
      }
    }
  }

  async function queueEvent(event) {
    if (!event || !event.appointmentId) {
      console.warn("[SF QUEUE] Cannot queue event without appointmentId:", event);
      return;
    }

    const withUser = {
      ...event,
      userSub: user?.sub,
      userEmail: user?.email,
      userName: user?.name,
    };

    await queueSfEvent(withUser);

    // Don’t swallow errors; let UI see them
    if (navigator.onLine) {
      await syncPending();
    }
  }

  return { queueEvent, syncPending };
}