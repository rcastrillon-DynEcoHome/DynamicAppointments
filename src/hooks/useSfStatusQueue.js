// src/hooks/useSfStatusQueue.js
import {
  queueSfEvent,
  getPendingSfEvents,
  markSfEventCompleted,
} from "../lib/sfEventsDb.js";

const API_BASE = "https://99f8idw2h9.execute-api.us-east-1.amazonaws.com";

function toApptEventKey(appointmentId, eventType) {
  return `${appointmentId || ""}::${eventType || ""}`;
}

function normalizeErrMessage(errObj) {
  if (!errObj) return "Unknown error";
  if (typeof errObj === "string") return errObj;

  const arr = Array.isArray(errObj) ? errObj : [errObj];
  const first = arr[0] || {};
  const code = first.errorCode || first.code || "ERROR";
  const msg = first.message || first.Message || JSON.stringify(first);
  return `${code}: ${msg}`;
}

function parseMs(s) {
  const t = Date.parse(s || "");
  return Number.isFinite(t) ? t : 0;
}

function isOkResult(r) {
  if (!r) return false;
  if (r.success === true) return true;
  const sc = Number(r.statusCode);
  return sc === 204 || sc === 200;
}

function extractErrorCode(r) {
  const err = r?.error ?? r?.errors ?? null;
  if (!err) return "";
  const arr = Array.isArray(err) ? err : [err];
  const first = arr[0] || {};
  return String(first.errorCode || first.code || "").toUpperCase();
}

function isPermanentFailure(r) {
  // Treat this specific Salesforce-style 404 as permanent to avoid infinite retry loops.
  const sc = Number(r?.statusCode);
  const code = extractErrorCode(r);
  const msg = normalizeErrMessage(r?.error ?? r?.errors ?? null);

  if (sc === 404 && code === "NOT_FOUND") return true;

  // Extra guard: common message you’re seeing
  if (
    sc === 404 &&
    msg.toLowerCase().includes("provided external id field does not exist")
  ) {
    return true;
  }

  return false;
}

async function sendEventsBatchToSalesforce(idToken, events) {
  if (!events || !events.length) return { data: null, rawText: "" };

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

  console.log(
    "[SF QUEUE] POST",
    url,
    JSON.stringify(
      { count: events.length, first: body.events?.[0] || null },
      null,
      2
    )
  );

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
    console.log(
      "[SF QUEUE] HTTP ERROR",
      JSON.stringify(
        { status: res.status, statusText: res.statusText, rawText },
        null,
        2
      )
    );
    throw new Error(
      `sfStatusEvents failed: ${res.status} ${res.statusText} – ${rawText}`
    );
  }

  let data = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = null;
  }

  console.log(
    "[SF QUEUE] Sync response (rawText):",
    rawText ? rawText.slice(0, 4000) : "(empty)"
  );
  console.log(
    "[SF QUEUE] Sync response (parsed):",
    JSON.stringify(data, null, 2)
  );

  return { data, rawText };
}

export function useSfStatusQueue({ idToken, user }) {
  async function syncPending() {
    const empty = {
      processed: 0,
      completed: 0,
      keptPending: 0,
      droppedPermanent: 0,
      resultsByApptEvent: {},
      raw: null,
      rawText: "",
    };

    if (!idToken || !navigator.onLine) {
      return empty;
    }

    const pending = await getPendingSfEvents();
    if (!pending.length) return empty;

    const { data, rawText } = await sendEventsBatchToSalesforce(idToken, pending);
    const results = Array.isArray(data?.results) ? data.results : [];

    // latest result per appointmentId + eventType
    const resultsByApptEvent = {};

    for (const r of results) {
      const apptId = r?.event?.appointmentId ?? r?.appointmentId ?? "";
      const evtType = r?.eventType ?? r?.event?.eventType ?? "";
      const occ = r?.occurredAt ?? r?.event?.occurredAt ?? "";

      const ok = isOkResult(r);
      const key = toApptEventKey(apptId, evtType);

      const candidate = {
        ok,
        appointmentId: apptId,
        eventType: evtType,
        occurredAt: occ,
        statusCode: r?.statusCode,
        errorObj: r?.error ?? r?.errors ?? null,
        errorMessage: ok
          ? ""
          : normalizeErrMessage(r?.error ?? r?.errors ?? null),
        _ts: parseMs(occ),
        _permanent: !ok && isPermanentFailure(r),
      };

      const existing = resultsByApptEvent[key];
      if (!existing || candidate._ts >= (existing._ts || 0)) {
        resultsByApptEvent[key] = candidate;
      }
    }

    let completed = 0;
    let keptPending = 0;
    let droppedPermanent = 0;

    for (const evt of pending) {
      const key = toApptEventKey(evt.appointmentId, evt.eventType);
      const outcome = resultsByApptEvent[key];

      if (!outcome) {
        keptPending += 1;
        continue;
      }

      // ✅ success => remove from queue
      if (outcome.ok) {
        try {
          await markSfEventCompleted(evt.id);
          completed += 1;
        } catch {
          keptPending += 1;
        }
        continue;
      }

      // ✅ permanent failure => drop from queue to avoid infinite retries
      if (outcome._permanent) {
        console.warn(
          "[SF QUEUE] Dropping permanent failure:",
          JSON.stringify(
            {
              id: evt.id,
              appointmentId: evt.appointmentId,
              eventType: evt.eventType,
              statusCode: outcome.statusCode,
              errorMessage: outcome.errorMessage,
            },
            null,
            2
          )
        );
        try {
          await markSfEventCompleted(evt.id);
          droppedPermanent += 1;
        } catch {
          keptPending += 1;
        }
        continue;
      }

      // transient failure => keep pending
      keptPending += 1;
    }

    return {
      processed: pending.length,
      completed,
      keptPending,
      droppedPermanent,
      resultsByApptEvent,
      raw: data,
      rawText,
    };
  }

  /**
   * Queue an event; optionally auto-sync and return sync result.
   * @param {Object} event
   * @param {Object} opts
   * @param {boolean} opts.autoSync default true
   */
  async function queueEvent(event, opts = {}) {
    const autoSync = opts.autoSync !== false;

    if (!event || !event.appointmentId) {
      console.warn(
        "[SF QUEUE] Cannot queue event without appointmentId:",
        JSON.stringify(event, null, 2)
      );
      return { queued: null, syncRes: null };
    }

    const withUser = {
      ...event,
      userSub: user?.sub,
      userEmail: user?.email,
      userName: user?.name,
    };

    console.log("[SF QUEUE] queueEvent:", JSON.stringify(withUser, null, 2));

    const queued = await queueSfEvent(withUser);

    if (!autoSync) return { queued, syncRes: null };

    // auto-sync only if we can actually call the API
    if (navigator.onLine && idToken) {
      try {
        const syncRes = await syncPending();
        return { queued, syncRes };
      } catch (e) {
        console.warn("[SF QUEUE] Auto-sync failed (transient):", e);
        return { queued, syncRes: null };
      }
    }

    return { queued, syncRes: null };
  }

  return { queueEvent, syncPending };
}
