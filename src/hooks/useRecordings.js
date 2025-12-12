// src/hooks/useRecordings.js
import { useCallback, useEffect, useMemo, useState } from "react";
import { getDeviceId } from "../lib/device.js";
import {
  saveRecording,
  getAllRecordings,
  deleteRecording,
} from "../lib/db.js";
import {
  getUploadUrl,
  listRecordings,
} from "../lib/apiClient.js";

/**
 * Helper: format time like your old formatTime()
 */
function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return "0:00";
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Helper: compute duration from an audio Blob, like old getAudioDuration()
 */
function getAudioDuration(blob) {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(blob);
      const audio = new Audio();
      audio.src = url;

      audio.addEventListener("loadedmetadata", () => {
        URL.revokeObjectURL(url);
        if (isNaN(audio.duration)) {
          resolve(null);
        } else {
          resolve(audio.duration);
        }
      });

      audio.addEventListener("error", (e) => {
        console.error("Error loading audio metadata", e);
        URL.revokeObjectURL(url);
        resolve(null);
      });
    } catch (err) {
      console.error("getAudioDuration error", err);
      resolve(null);
    }
  });
}

/**
 * Hook that:
 * - Tracks local recordings (IndexedDB) and cloud recordings (DynamoDB via API)
 * - Uploads pending/failed local recordings to S3
 * - Keeps a unified list (local + cloud) with filters
 */
export function useRecordings({ idToken, user }) {
  const deviceId = useMemo(() => getDeviceId(), []);

  // Filters (with same defaults: from 3 days ago to today)
  const today = useMemo(() => new Date(), []);
  const threeDaysAgo = useMemo(() => {
    const d = new Date(today);
    d.setDate(today.getDate() - 3);
    return d;
  }, [today]);

  const [filterFrom, setFilterFrom] = useState(
    threeDaysAgo.toISOString().slice(0, 10)
  );
  const [filterTo, setFilterTo] = useState(
    today.toISOString().slice(0, 10)
  );
  const [filterStatus, setFilterStatus] = useState("");
  const [filterDevice, setFilterDevice] = useState("");

  const [localRecordings, setLocalRecordings] = useState([]);
  const [cloudRecordings, setCloudRecordings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(null);

  /**
   * Load local recordings from IndexedDB
   */
  const loadLocalRecordings = useCallback(async () => {
    try {
      const all = await getAllRecordings();
      setLocalRecordings(all || []);
      return all || [];
    } catch (err) {
      console.error("loadLocalRecordings error", err);
      setError(err.message);
      return [];
    }
  }, []);

  /**
   * Fetch cloud recordings from API, respecting filters
   */
  const fetchCloudRecordings = useCallback(async () => {
    if (!idToken || !navigator.onLine) {
      setCloudRecordings([]);
      return [];
    }

    try {
      const params = {};

      if (filterFrom) params.from = filterFrom;
      if (filterTo) params.to = filterTo;
      if (filterStatus === "uploaded") params.status = "uploaded";
      if (filterDevice === "this") params.deviceId = deviceId;

      const data = await listRecordings(idToken, params);
      const items = data.items || [];
      setCloudRecordings(items);
      return items;
    } catch (err) {
      console.error("fetchCloudRecordings error", err);
      setError(err.message);
      setCloudRecordings([]);
      return [];
    }
  }, [idToken, filterFrom, filterTo, filterStatus, filterDevice, deviceId]);

  /**
   * Unified list builder (local + cloud) with duplicate removal & filters,
   * mirroring your old refreshRecordingsList logic.
   */
  const unifiedRecordings = useMemo(() => {
    const cloudKeySet = new Set();
    for (const item of cloudRecordings) {
      if (item && item.s3Key) {
        cloudKeySet.add(item.s3Key);
      }
    }

    const unified = [];

    // Local items
    for (const item of localRecordings) {
      // If local is uploaded and there is a cloud item with the same s3Key, skip
      if (
        item.status === "uploaded" &&
        item.s3Key &&
        cloudKeySet.has(item.s3Key)
      ) {
        continue;
      }
      unified.push({
        id: item.id,
        source: "local",
        local: item,
        createdAt: item.createdAt,
        appointmentId: item.appointmentId,
        status: item.status || "pending",
        durationSeconds: item.durationSeconds,
        deviceId,
        hasBlob: true,
        transcriptionStatus: item.transcriptionStatus || "",
      });
    }

    // Cloud items
    for (const item of cloudRecordings) {
      unified.push({
        id: item.recordingId || item.s3Key || item.createdAt,
        source: "cloud",
        cloud: item,
        createdAt: item.createdAt,
        appointmentId: item.appointmentId,
        status: item.status || "uploaded",
        durationSeconds: item.durationSeconds,
        deviceId: item.deviceId,
        hasBlob: false,
        transcriptionStatus: item.transcriptionStatus || "",
      });
    }

    // Apply filters (from/to/status/device)
    let rows = unified;

    if (filterFrom) {
      const fromDate = new Date(filterFrom + "T00:00:00");
      rows = rows.filter((r) => new Date(r.createdAt) >= fromDate);
    }

    if (filterTo) {
      const toDate = new Date(filterTo + "T23:59:59");
      rows = rows.filter((r) => new Date(r.createdAt) <= toDate);
    }

    if (filterStatus) {
      rows = rows.filter((r) => r.status === filterStatus);
    }

    if (filterDevice === "this") {
      rows = rows.filter((r) => r.deviceId === deviceId);
    }

    rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return rows;
  }, [
    localRecordings,
    cloudRecordings,
    filterFrom,
    filterTo,
    filterStatus,
    filterDevice,
    deviceId,
  ]);

  /**
   * Upload a single local recording to S3 (mirrors old uploadRecording)
   */
  const uploadRecording = useCallback(
    async (item) => {
      if (!navigator.onLine) {
        setMessage("Offline: will upload when back online.");
        return;
      }

      if (!idToken) {
        setMessage("Not authenticated. Please sign in again.");
        return;
      }

      setUploading(true);
      try {
        setMessage("Requesting upload URL…");
        item.status = "uploading";
        item.lastError = undefined;
        await saveRecording(item);
        await loadLocalRecordings();

        const contentType = item.blob?.type || "audio/mp4";

        const data = await getUploadUrl(idToken, {
          appointmentId: item.appointmentId,
          fileName: "recording",
          contentType,
          deviceId,
          durationSeconds: item.durationSeconds,
        });

        if (!data.uploadUrl) {
          throw new Error("No uploadUrl returned");
        }

        const key = data.s3Key || data.fileKey;
        if (key) {
          item.s3Key = key;
          await saveRecording(item);
        }

        setMessage("Uploading recording…");
        await fetch(data.uploadUrl, {
          method: "PUT",
          body: item.blob,
          headers: { "Content-Type": contentType },
        });

        item.status = "uploaded";
        await saveRecording(item);

        setMessage("Upload complete.");
        await loadLocalRecordings();
        await fetchCloudRecordings();
      } catch (err) {
        console.error("uploadRecording error", err);
        item.status = "failed";
        item.lastError = err.message;
        await saveRecording(item);
        setMessage("Upload failed: " + err.message);
        await loadLocalRecordings();
      } finally {
        setUploading(false);
      }
    },
    [idToken, deviceId, loadLocalRecordings, fetchCloudRecordings]
  );

  /**
   * Trigger upload cycle for all pending/failed items
   * (used by Sync Recordings)
   */
  const syncUploads = useCallback(async () => {
    if (!navigator.onLine) {
      setMessage("Offline: unable to sync uploads.");
      return;
    }

    setMessage("Syncing uploads…");

    const all = await getAllRecordings();
    const pending = (all || []).filter(
      (i) => i.status === "pending" || i.status === "failed"
    );

    for (const item of pending) {
      await uploadRecording(item);
    }

    // After all uploads, refresh local + cloud (extra safety)
    await loadLocalRecordings();
    await fetchCloudRecordings();

    setMessage("Sync complete.");
  }, [uploadRecording, loadLocalRecordings, fetchCloudRecordings]);

  /**
   * Save a brand new local recording (from NewRecordingPanel) and optionally upload
   */
  const saveNewLocalRecording = useCallback(
    async ({ blob, appointmentId }) => {
      if (!blob) {
        throw new Error("No recording blob to save");
      }
      if (!appointmentId) {
        throw new Error("Appointment ID is required to save");
      }

      const durationSeconds = (await getAudioDuration(blob)) || 0;

      const id = self.crypto?.randomUUID
        ? self.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

      const record = {
        id,
        appointmentId,
        createdAt: new Date().toISOString(),
        blob,
        status: "pending",
        durationSeconds,
        user: user
          ? {
              sub: user.sub,
              email: user.email,
              name: user.name,
            }
          : null,
      };

      await saveRecording(record);
      await loadLocalRecordings();

      if (navigator.onLine) {
        setMessage("Recording saved on device. Uploading now…");
        await uploadRecording(record);
      } else {
        setMessage(
          "Recording saved on device. It will upload when you are back online."
        );
      }

      return record;
    },
    [user, uploadRecording, loadLocalRecordings]
  );

  /**
   * Delete a local recording by id
   */
  const deleteLocal = useCallback(
    async (id) => {
      await deleteRecording(id);
      await loadLocalRecordings();
    },
    [loadLocalRecordings]
  );

  /**
   * Clear local copies of any items that are already uploaded,
   * regardless of whether we currently see a matching cloud row.
   * This is what the Sync button should do after uploads complete.
   */
  const clearUploadedLocals = useCallback(async () => {
    const all = await getAllRecordings();

    for (const r of all || []) {
      if (r.status === "uploaded") {
        await deleteRecording(r.id);
      }
    }

    // Reload locals and refresh cloud,
    // which will also refresh unifiedRecordings via useMemo
    await loadLocalRecordings();
    await fetchCloudRecordings();
  }, [loadLocalRecordings, fetchCloudRecordings]);

  /**
   * Initial load and refresh when filters or idToken change
   */
  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      await loadLocalRecordings();
      await fetchCloudRecordings();
    } finally {
      setLoading(false);
    }
  }, [loadLocalRecordings, fetchCloudRecordings]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  /**
   * Auto-upload cycle when going online
   */
  useEffect(() => {
    function handleOnline() {
      syncUploads();
      fetchCloudRecordings();
    }

    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, [syncUploads, fetchCloudRecordings]);

  return {
    deviceId,
    // filters
    filterFrom,
    filterTo,
    filterStatus,
    filterDevice,
    setFilterFrom,
    setFilterTo,
    setFilterStatus,
    setFilterDevice,
    // data
    localRecordings,
    cloudRecordings,
    unifiedRecordings,
    loading,
    uploading,
    message,
    error,
    // actions
    refreshAll,
    saveNewLocalRecording,
    uploadRecording,
    syncUploads,
    deleteLocal,
    clearUploadedLocals,
    formatTime, // handy for UI
  };
}
