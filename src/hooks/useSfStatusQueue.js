// src/hooks/useSfStatusQueue.js
import {
  queueSfEvent,
  getPendingSfEvents,
  markSfEventCompleted,
} from "../lib/sfEventsDb.js";

const API_BASE = "https://99f8idw2h9.execute-api.us-east-1.amazonaws.com";

/**
 * Send a batch of queued events to your SF status Lambda via API Gateway.
 *
 * Expects API:
 *   POST {API_BASE}/sfStatusEvents
 *   Body: { events: [ { appointmentId, eventType, statusValue, occurredAt, ... }, ... ] }
 *
 * If the call succeeds (2xx), we treat all events as successfully processed.
 * If it fails, we throw so the caller can retry later.
 */
async function sendEventsBatchToSalesforce(idToken, events) {
  if (!events || !events.length) return;

  const body = {
    events: events.map((e) => ({
      // Core fields used by the Lambda
      appointmentId: e.appointmentId,
      eventType: e.eventType,
      statusValue: e.statusValue,
      occurredAt: e.occurredAt,
      // Extra metadata (user) goes along for debugging / audit if you want
      userSub: e.userSub,
      userEmail: e.userEmail,
      userName: e.userName,
    })),
  };

  const res = await fetch(`${API_BASE}/sfStatusEvents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `sfStatusEvents failed: ${res.status} ${res.statusText} – ${text}`
    );
  }

  // You *can* inspect the response for per-event successes if you want:
  // const data = await res.json();
  // console.debug("[SF QUEUE] Sync response:", data);
  // For now we just assume all events in the batch are good on any 2xx.
}

/**
 * Hook that:
 *  - lets you queue offline-safe SF status events
 *  - syncs them via API Gateway / Lambda when online + authenticated
 */
export function useSfStatusQueue({ idToken, user }) {
  /**
   * Queue an event (works offline) and attempt immediate sync if online.
   * event: { appointmentId, eventType, statusValue, occurredAt }
   */
  async function queueEvent(event) {
    if (!event || !event.appointmentId) {
      console.warn(
        "[SF QUEUE] Cannot queue event without appointmentId:",
        event
      );
      return;
    }

    const withUser = {
      ...event,
      userSub: user?.sub,
      userEmail: user?.email,
      userName: user?.name,
    };

    // Store in IndexedDB as PENDING
    await queueSfEvent(withUser);

    // If we're online, try to sync immediately
    if (navigator.onLine) {
      try {
        await syncPending();
      } catch (e) {
        console.warn("[SF QUEUE] Immediate sync failed:", e);
        // Do not remove events; they'll retry later.
      }
    }
  }

  /**
   * Process all pending events:
   *  - If not authenticated, it no-ops.
   *  - If offline, it no-ops.
   *  - Sends all PENDING events in one batch to the API.
   *  - On success, marks them COMPLETED in IndexedDB.
   */
  async function syncPending() {
    if (!idToken || !user) {
      // No auth → we can't safely call SF, so just skip.
      console.debug("[SF QUEUE] Skipping sync: no idToken or user.");
      return;
    }

    if (!navigator.onLine) {
      console.debug("[SF QUEUE] Skipping sync: offline.");
      return;
    }

    const pending = await getPendingSfEvents();
    if (!pending.length) {
      return;
    }

    try {
      await sendEventsBatchToSalesforce(idToken, pending);

      // If the call succeeds, mark all as completed
      for (const evt of pending) {
        try {
          await markSfEventCompleted(evt.id);
        } catch (e) {
          console.warn(
            "[SF QUEUE] Failed to mark event completed (will not retry this one):",
            evt.id,
            e
          );
        }
      }
    } catch (e) {
      console.warn(
        "[SF QUEUE] Failed to sync batch, will retry on next sync:",
        e
      );
      // Do NOT mark any completed; they'll retry on next sync.
    }
  }

  return { queueEvent, syncPending };
}
