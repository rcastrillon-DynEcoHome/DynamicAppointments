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
import {
  captureSalesforceReturnUrlFromLocation,
  returnToFieldService,
} from "./lib/sfDeepLink.js";

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

  // Read appointmentId + optional returnUrl from URL on first load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialAppointmentId = params.get("appointmentId") || "";
    setAppointmentId(initialAppointmentId);

    // Optional: if Salesforce (or a wrapper) passes a return URL, capture it.
    captureSalesforceReturnUrlFromLocation(window.location.href);
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
      if ("indexedDB" in window) {
        try {
          indexedDB.deleteDatabase("fs-voice-recorder");
        } catch (e) {
          console.warn("Error deleting IndexedDB", e);
        }
      }

      if ("caches" in window) {
        const names = await caches.keys();
        await Promise.all(names.map((name) => caches.delete(name)));
      }

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
      await syncUploads?.();
      await clearUploadedLocals?.();
      await syncSfPending();

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
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (prevUrlRef.current && prevUrlRef.current.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(prevUrlRef.current);
      } catch (_) {}
    }

    if (!audioUrl) {
      audio.pause?.();
      audio.removeAttribute("src");
      audio.load?.();
      prevUrlRef.current = null;
      return;
    }

    audio.src = audioUrl;
    prevUrlRef.current = audioUrl;

    audio.playbackRate = playerSpeed;
    audio.play().catch(() => {});

    setPlayerIsPlaying(true);
  }, [audioUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = playerSpeed;
  }, [playerSpeed]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    function onTimeUpdate() {
      const cur = audio.currentTime || 0;
      const dur = audio.duration || 0;
      const pct = dur > 0 ? Math.min(100, Math.max(0, (cur / dur) * 100)) : 0;
      setPlayerSeek(pct);
      setPlayerTimeText(`${formatTimeDisplay(cur)} / ${formatTimeDisplay(dur)}`);
    }

    function onEnded() {
      setPlayerIsPlaying(false);
    }

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
    };
  }, []);

  const handlePlayerPlayPause = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      audio.play().catch(() => {});
      setPlayerIsPlaying(true);
    } else {
      audio.pause();
      setPlayerIsPlaying(false);
    }
  };

  const handlePlayerSeek = (pct) => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    const newTime = (Math.max(0, Math.min(100, pct)) / 100) * audio.duration;
    audio.currentTime = newTime;
  };

  const handlePlayerSpeedDown = () => setPlayerSpeed((s) => Math.max(0.5, +(s - 0.1).toFixed(2)));
  const handlePlayerSpeedUp = () => setPlayerSpeed((s) => Math.min(3.0, +(s + 0.1).toFixed(2)));

  const handleSelectRecording = async (rec) => {
    setSelectedRecording(rec);
    setPlayerVisible(true);

    const dateStr = new Date(rec.createdAt).toLocaleString();
    setPlayerTitle(rec.appointmentId || "(no appointment)");
    setPlayerMeta(`${dateStr} — ${rec.status || "unknown"}`);

    try {
      if (rec.source === "cloud" && rec.s3Key) {
        const url = await getPlaybackUrl({ idToken, s3Key: rec.s3Key });
        setAudioUrl(url);
      } else if (rec.source === "local" && rec.blob) {
        const url = URL.createObjectURL(rec.blob);
        setAudioUrl(url);
      } else {
        setStatusText("Unable to play: missing audio source.");
      }
    } catch (e) {
      console.error("Playback URL error", e);
      setStatusText("Unable to start playback: " + e.message);
    }
  };

  const handlePreviewRecording = async (item) => {
    setSelectedRecording(null);
    setPlayerVisible(true);

    const dateStr = new Date(item.createdAt).toLocaleString();
    setPlayerTitle(item.appointmentId || "(no appointment)");
    setPlayerMeta(`${dateStr} — Preview (not yet saved)`);

    const url = URL.createObjectURL(item.blob);
    setAudioUrl(url);

    setStatusText("Previewing current recording (not yet saved).");
  };

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

  // On save, deep-link the user back into Field Service (instead of status update).
  const handleReturnToFieldService = async (savedRecord) => {
    const apptId = savedRecord?.appointmentId || appointmentId;
    if (!apptId) return;

    try {
      await returnToFieldService({ appointmentId: apptId });
    } catch (e) {
      console.warn("Failed to deep-link back to Field Service", e);
      setStatusText(
        "Saved, but couldn't open Field Service automatically. Please switch back to Field Service manually."
      );
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
          onAfterSave={handleReturnToFieldService}
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
