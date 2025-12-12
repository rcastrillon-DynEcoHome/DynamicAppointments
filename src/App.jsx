// src/App.jsx
import React, { useEffect, useRef, useState } from "react";
import Header from "./components/Header.jsx";
import RecordingStatusBanner from "./components/RecordingStatusBanner.jsx";
import TabBar from "./components/TabBar.jsx";
import NewRecordingPanel from "./components/NewRecordingPanel.jsx";
import RecordingsList from "./components/RecordingsList.jsx";
import AudioPlayer from "./components/AudioPlayer.jsx";
import { useAuth } from "./hooks/useAuth.js";
import { useRecordings } from "./hooks/useRecordings.js";
import { getPlaybackUrl } from "./lib/apiClient.js";
import { useSfStatusQueue } from "./hooks/useSfStatusQueue.js";

function formatTimeDisplay(seconds) {
  if (!seconds || isNaN(seconds)) return "0:00";
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function App() {
  // ==== AUTH ====
  const { user, loading, isAuthenticated, logout, idToken } = useAuth();

  // ==== RECORDINGS (local + cloud) ====
  const {
    deviceId,
    filterFrom,
    filterTo,
    filterStatus,
    filterDevice,
    setFilterFrom,
    setFilterTo,
    setFilterStatus,
    setFilterDevice,
    unifiedRecordings,
    message: recordingsMessage,
    loading: recordingsLoading,
    saveNewLocalRecording,
    uploadRecording,
    syncUploads,
    deleteLocal,
    clearUploadedLocals,
  } = useRecordings({ idToken, user });

  // ==== SALESFORCE STATUS QUEUE (offline-safe) ====
  const { queueEvent: queueSfEvent, syncPending: syncSfPending } =
    useSfStatusQueue({ idToken, user });

  // Header display
  const [userDisplay, setUserDisplay] = useState("User: (unknown)");

  // Appointment ID
  const [appointmentId, setAppointmentId] = useState("");

  // Active tab: "new" | "list"
  const [activeTab, setActiveTab] = useState("new");

  // Status text under "New Recording"
  const [statusText, setStatusText] = useState("");

  // Network status in footer
  const [networkStatus, setNetworkStatus] = useState(
    navigator.onLine ? "Online" : "Offline"
  );

  // Recording banner state: "hidden" | "recording" | "paused" | "ready"
  const [recordingBannerState, setRecordingBannerState] =
    useState("hidden");

  // Settings menu open/closed
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ==== PLAYER STATE ====
  const audioRef = useRef(null);
  const prevUrlRef = useRef(null);

  const [playerVisible, setPlayerVisible] = useState(false);
  const [playerTitle, setPlayerTitle] = useState("");
  const [playerMeta, setPlayerMeta] = useState("");
  const [playerTimeText, setPlayerTimeText] = useState("0:00 / 0:00");
  const [playerSeek, setPlayerSeek] = useState(0); // 0–100
  const [playerIsPlaying, setPlayerIsPlaying] = useState(false);
  const [playerSpeed, setPlayerSpeed] = useState(1.0);
  const [audioUrl, setAudioUrl] = useState(null);
  const [selectedRecording, setSelectedRecording] = useState(null);

  // ==== USER DISPLAY ====
  useEffect(() => {
    if (user) {
      setUserDisplay(`User: ${user.name || user.email || "(unknown)"}`);
    } else {
      setUserDisplay("User: (unknown)");
    }
  }, [user]);

  // Read appointmentId from URL on first load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialAppointmentId = params.get("appointmentId") || "";
    setAppointmentId(initialAppointmentId);
  }, []);

  // Online/offline handling
  useEffect(() => {
    function handleOnline() {
      setNetworkStatus("Online");
      setStatusText(
        "Back online. Pending uploads and status updates will resume automatically."
      );
      syncSfPending();
      syncUploads?.();
    }

    function handleOffline() {
      setNetworkStatus("Offline");
      setStatusText(
        "You are offline. You can record or load files; uploads and status updates will wait."
      );
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [syncSfPending, syncUploads]);

  // Derived appointment label text
  const appointmentDisplayText = appointmentId
    ? `Appointment: ${appointmentId} ✏️`
    : "Appointment: (not set) ✏️";

  const handleAppointmentClick = () => {
    const newId = window.prompt(
      "Enter appointment ID",
      appointmentId ? appointmentId : ""
    );
    if (newId === null) return;
    const trimmed = newId.trim();
    setAppointmentId(trimmed);

    if (!trimmed) {
      setStatusText("Appointment ID cleared. Set one before saving.");
    } else {
      setStatusText(`Using appointment ID: ${trimmed}`);
    }
  };

  // ==== SETTINGS MENU HELPERS ====

  const clearAppCacheAndReload = async () => {
    const confirmed = window.confirm(
      "This will delete locally stored recordings and app cache on this device, then reload the app. Cloud uploads are not affected. Continue?"
    );
    if (!confirmed) return;

    try {
      // Delete IndexedDB used for recordings
      if ("indexedDB" in window) {
        try {
          // Name must match db.js
          indexedDB.deleteDatabase("fs-voice-recorder");
        } catch (e) {
          console.warn("Error deleting IndexedDB", e);
        }
      }

      // Clear any caches (PWA / Vite / etc.)
      if ("caches" in window) {
        const names = await caches.keys();
        await Promise.all(names.map((name) => caches.delete(name)));
      }

      // Unregister any service workers (for PWA install)
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((reg) => reg.unregister()));
      }

      setStatusText("Cache cleared. Reloading…");
    } catch (err) {
      console.error("Failed to clear cache", err);
      alert("Failed to fully clear cache, but some data may still be removed.");
    } finally {
      window.location.reload();
    }
  };

  const handleSyncRecordings = async () => {
    setSettingsOpen(false);
    setStatusText("Syncing recordings and status updates…");

    try {
      await syncUploads?.();       // upload pending/failed
      await clearUploadedLocals?.(); // clear uploaded from local IDB
      await syncSfPending();       // push SF events

      setStatusText("Sync complete.");
    } catch (e) {
      console.error("Sync error", e);
      setStatusText("Sync failed: " + e.message);
    }
  };

  const handleClearCache = async () => {
    setSettingsOpen(false);
    await clearAppCacheAndReload();
  };

  const handleSignOut = () => {
    setSettingsOpen(false);
    logout();
  };

  // ==== PLAYER LOGIC ====

  // Whenever audioUrl changes, update the <audio> element and auto-play
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // Revoke old blob URL if needed
    if (prevUrlRef.current && prevUrlRef.current.startsWith("blob:")) {
      URL.revokeObjectURL(prevUrlRef.current);
    }
    prevUrlRef.current = audioUrl || null;

    audio.src = audioUrl || "";
    // 🔹 Make sure browser loads metadata so duration is available
    if (audioUrl) {
      try {
        audio.load();
      } catch (e) {
        console.warn("audio.load() failed", e);
      }
    }

    setPlayerTimeText("0:00 / 0:00");
    setPlayerSeek(0);
    setPlayerIsPlaying(false);

    if (!audioUrl) return;

    audio
      .play()
      .then(() => {
        setPlayerIsPlaying(true);
      })
      .catch(() => {
        setPlayerIsPlaying(false);
      });
  }, [audioUrl]);

  // Attach timeupdate/loadedmetadata/ended handlers
  // 🔹 Depend on audioUrl so this runs once the <audio> ref is definitely mounted
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      const current = audio.currentTime || 0;
      const total = audio.duration || 0;
      const currentStr = formatTimeDisplay(current);
      const totalStr = formatTimeDisplay(total);
      setPlayerTimeText(`${currentStr} / ${totalStr}`);

      if (total > 0) {
        setPlayerSeek((current / total) * 100);
      } else {
        setPlayerSeek(0);
      }
    };

    const handleLoadedMetadata = () => {
      handleTimeUpdate();
    };

    const handleEnded = () => {
      setPlayerIsPlaying(false);
      setPlayerSeek(100);
    };

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [audioUrl]);

  // Speed changes -> apply to audio element
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = playerSpeed;
  }, [playerSpeed]);

  const handlePlayerPlayPause = () => {
    const audio = audioRef.current;
    if (!audio || !audio.src) return;

    if (audio.paused) {
      audio
        .play()
        .then(() => setPlayerIsPlaying(true))
        .catch((err) => {
          console.error("Playback error", err);
          setStatusText("Unable to play this audio on this device.");
        });
    } else {
      audio.pause();
      setPlayerIsPlaying(false);
    }
  };

  const handlePlayerSeek = (value) => {
    const audio = audioRef.current;
    if (!audio || !audio.duration || isNaN(audio.duration)) return;
    const pct = Number(value) / 100;
    audio.currentTime = audio.duration * pct;
    setPlayerSeek(pct * 100);
  };

  const handlePlayerSpeedDown = () => {
    setPlayerSpeed((prev) => Math.max(0.25, prev - 0.25));
  };

  const handlePlayerSpeedUp = () => {
    setPlayerSpeed((prev) => Math.min(3.0, prev + 0.25));
  };

  // When a row is clicked in My Recordings
  const handleSelectRecording = async (record) => {
    setSelectedRecording(record);
    setPlayerVisible(true);

    setPlayerTitle(record.appointmentId || "(no appointment)");

    const dateStr = new Date(record.createdAt).toLocaleString();
    let durationStr = "";
    if (
      typeof record.durationSeconds === "number" &&
      !isNaN(record.durationSeconds)
    ) {
      const mins = Math.floor(record.durationSeconds / 60);
      const secs = Math.round(record.durationSeconds % 60)
        .toString()
        .padStart(2, "0");
      durationStr = ` • ${mins}:${secs} min`;
    }
    const cloudLabel = record.source === "cloud" ? " — Cloud recording" : "";
    setPlayerMeta(`${dateStr}${durationStr}${cloudLabel}`);

    try {
      if (record.source === "local" && record.local?.blob) {
        const url = URL.createObjectURL(record.local.blob);
        setAudioUrl(url);
        setStatusText("Playing local recording.");
      } else if (
        record.source === "cloud" &&
        record.cloud?.s3Key &&
        idToken
      ) {
        setStatusText("Fetching audio from cloud…");
        const data = await getPlaybackUrl(idToken, {
          s3Key: record.cloud.s3Key,
        });
        if (!data.playbackUrl) {
          throw new Error("No playbackUrl returned");
        }
        setAudioUrl(data.playbackUrl);
        setStatusText("Playing cloud recording.");
      } else {
        setStatusText("Unable to play this recording (missing data).");
      }
    } catch (err) {
      console.error("Cloud playback error", err);
      setStatusText("Unable to play cloud recording: " + err.message);
    }
  };

  const handlePreviewRecording = (item) => {
    // item: { blob, appointmentId, createdAt }
    setSelectedRecording(null); // just a preview, not a stored record
    setPlayerVisible(true);

    const dateStr = new Date(item.createdAt).toLocaleString();

    setPlayerTitle(item.appointmentId || "(no appointment)");
    setPlayerMeta(`${dateStr} — Preview (not yet saved)`);

    const url = URL.createObjectURL(item.blob);
    setAudioUrl(url);

    setStatusText("Previewing current recording (not yet saved).");
  };

  // Player speed text
  const playerSpeedText = `${playerSpeed.toFixed(2).replace(/\.00$/, "")}x`;

  // ==== SALESFORCE STATUS HELPERS ====

  const handleMarkStartInSalesforce = async () => {
    if (!appointmentId) return;
    try {
      await queueSfEvent({
        appointmentId,
        eventType: "START",
        statusValue: "Arrived/In Progress",
        occurredAt: new Date().toISOString(),
      });
    } catch (e) {
      console.warn("Failed to queue SF START event", e);
    }
  };

  const handleMarkSaveInSalesforce = async (savedRecord) => {
    const apptId = savedRecord?.appointmentId || appointmentId;
    if (!apptId) return;
    try {
      await queueSfEvent({
        appointmentId: apptId,
        eventType: "SAVE",
        statusValue: "Completed",
        occurredAt: savedRecord?.createdAt || new Date().toISOString(),
      });
    } catch (e) {
      console.warn("Failed to queue SF SAVE event", e);
    }
  };

  // ==== LOADING / AUTH GUARD ====
  if (loading) {
    return (
      <div className="c-main">
        <p>Loading…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="c-main">
        <p>Redirecting to sign-in…</p>
      </div>
    );
  }

  return (
    <div className="app-root">
      <div className="c-header-shell">
        <Header
          userDisplay={userDisplay}
          appointmentDisplay={""}
          onSettingsClick={() => setSettingsOpen((open) => !open)}
          isSettingsOpen={settingsOpen}
          onSyncRecordings={handleSyncRecordings}
          onClearCache={handleClearCache}
          onSignOut={handleSignOut}
        />

        <RecordingStatusBanner state={recordingBannerState} />
      </div>

      <main className="c-main">
        <TabBar activeTab={activeTab} onTabChange={setActiveTab} />

        {/* Keep both panels mounted; hide inactive one to avoid killing MediaRecorder */}
        <NewRecordingPanel
          isActive={activeTab === "new"}
          appointmentDisplayText={appointmentDisplayText}
          onAppointmentClick={handleAppointmentClick}
          statusText={statusText}
          onStatusChange={setStatusText}
          onBannerChange={setRecordingBannerState}
          appointmentId={appointmentId}
          onSaveRecording={saveNewLocalRecording}
          onSaved={() => setActiveTab("list")}
          onMarkStart={handleMarkStartInSalesforce}
          onMarkSave={handleMarkSaveInSalesforce}
          onPreviewRecording={handlePreviewRecording}
        />

        <RecordingsList
          isActive={activeTab === "list"}
          recordings={unifiedRecordings}
          filterFrom={filterFrom}
          filterTo={filterTo}
          filterStatus={filterStatus}
          filterDevice={filterDevice}
          setFilterFrom={setFilterFrom}
          setFilterTo={setFilterTo}
          setFilterStatus={setFilterStatus}
          setFilterDevice={setFilterDevice}
          loading={recordingsLoading}
          message={recordingsMessage}
          deviceId={deviceId}
          onUploadLocal={uploadRecording}
          onDeleteLocal={deleteLocal}
          onSelectRecording={handleSelectRecording}
        />
      </main>

      <div className="c-bottom-shell">
        <AudioPlayer
          visible={playerVisible}
          title={playerTitle}
          meta={playerMeta}
          timeText={playerTimeText}
          speedText={playerSpeedText}
          seekValue={playerSeek}
          isPlaying={playerIsPlaying}
          onPlayPause={handlePlayerPlayPause}
          onSeek={handlePlayerSeek}
          onSpeedDown={handlePlayerSpeedDown}
          onSpeedUp={handlePlayerSpeedUp}
          audioRef={audioRef}
        />
        <footer className="c-footer">
          <span id="networkStatus">{networkStatus}</span>
        </footer>
      </div>
    </div>
  );
}

export default App;
