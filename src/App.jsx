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
import { Capacitor } from "@capacitor/core";
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

// Extract appointmentId from links like:
// - https://host/record?appointmentId=TEST123
// - capacitor://localhost/record?appointmentId=TEST123
// (We also gracefully handle cases where the query string is embedded after a # fragment.)
function extractAppointmentIdFromUrl(urlString) {
  if (!urlString) return "";

  try {
    const u = new URL(urlString);
    const direct = u.searchParams.get("appointmentId");
    if (direct) return direct;

    const hash = u.hash || "";
    const qIndex = hash.indexOf("?");
    if (qIndex !== -1) {
      const params = new URLSearchParams(hash.slice(qIndex + 1));
      return params.get("appointmentId") || "";
    }

    return "";
  } catch {
    const qIndex = urlString.indexOf("?");
    if (qIndex !== -1) {
      const params = new URLSearchParams(urlString.slice(qIndex + 1));
      return params.get("appointmentId") || "";
    }
    return "";
  }
}

function SignInRedirect({ statusText, onLogin, disableAutoLogin = false }) {
  const startedRef = React.useRef(false);

  React.useEffect(() => {
    if (disableAutoLogin) return;
    if (startedRef.current) return;
    startedRef.current = true;
    onLogin?.();
  }, [onLogin, disableAutoLogin]);

  return (
    <div className="c-main">
      <p>Redirecting to sign-in…</p>
      {disableAutoLogin ? (
        <button
          className="c-btn c-btn-primary"
          onClick={() => onLogin?.()}
          style={{ marginTop: 12 }}
        >
          Sign in
        </button>
      ) : null}
      {statusText ? <p style={{ opacity: 0.8 }}>{statusText}</p> : null}
    </div>
  );
}

function App() {
  // ==== AUTH ====
  const { user, loading, isAuthenticated, login, logout, idToken } = useAuth();

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
  const [recordingBannerState, setRecordingBannerState] = useState("hidden");

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

  const hardResetAudio = () => {
    const a = audioRef.current;
    if (!a) return;
    try {
      a.pause();
      a.currentTime = 0;
      a.removeAttribute("src");
      a.load();
    } catch {}
    setPlayerIsPlaying(false);
    setPlayerSeek(0);
    setPlayerTimeText("0:00 / 0:00");
  };

  const updatePlayerUIFromAudio = () => {
    const audio = audioRef.current;
    if (!audio) return;

    const cur = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const dur = Number.isFinite(audio.duration) ? audio.duration : 0;

    const pct = dur > 0 ? Math.min(100, Math.max(0, (cur / dur) * 100)) : 0;
    setPlayerSeek(pct);
    setPlayerTimeText(`${formatTimeDisplay(cur)} / ${formatTimeDisplay(dur)}`);
  };

  // Prevent duplicate processing of the same incoming deep link
  const lastHandledUrlRef = useRef("");

  const handleIncomingDeepLink = (url) => {
    if (!url) return;

    if (lastHandledUrlRef.current === url) return;
    lastHandledUrlRef.current = url;

    captureSalesforceReturnUrlFromLocation(url);

    const appt = extractAppointmentIdFromUrl(url);
    if (appt) {
      setAppointmentId(appt);
      setActiveTab("new");
      setStatusText(`Opened from Field Service. Appointment ID set: ${appt}`);
    } else {
      setStatusText(
        "Opened from Field Service, but no appointmentId was found in the link."
      );
    }

    console.log(
      "[deeplink] handled:",
      url,
      "appointmentId:",
      appt || "(none)",
      "current href:",
      window.location.href
    );
  };

  // Handle deep link: cold start + appUrlOpen (native only)
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let sub;
    let cancelled = false;

    (async () => {
      const mod = await import("@capacitor/app");
      const CapApp = mod.App;

      if (cancelled) return;

      CapApp.getLaunchUrl()
        .then((res) => {
          if (res?.url) handleIncomingDeepLink(res.url);
        })
        .catch(() => {});

      sub = CapApp.addListener("appUrlOpen", (event) => {
        const url = event?.url || "";
        if (!url) return;
        handleIncomingDeepLink(url);
      });
    })().catch(() => {});

    return () => {
      cancelled = true;
      try {
        sub?.remove?.();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Log boot href once at app start
  useEffect(() => {
    console.log("[boot] href:", window.location.href);
  }, []);

  useEffect(() => {
    if (user) {
      setUserDisplay(`User: ${user.name || user.email || "(unknown)"}`);
    } else {
      setUserDisplay("User: (unknown)");
    }
  }, [user]);

  // Read appointmentId + optional returnUrl from URL on first load (browser + capacitor)
  useEffect(() => {
    const appt =
      extractAppointmentIdFromUrl(window.location.href) ||
      extractAppointmentIdFromUrl(window.location.toString());

    if (appt) setAppointmentId(appt);

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

  const appointmentDisplayText = appointmentId
    ? `Appointment: ${appointmentId} ✏️`
    : "Appointment: (not set) ✏️";

  const handleAppointmentClick = () => {
    const newId = window.prompt("Enter appointment ID", appointmentId || "");
    if (newId === null) return;
    const trimmed = newId.trim();
    setAppointmentId(trimmed);

    if (!trimmed) {
      setStatusText("Appointment ID cleared. Set one before saving.");
    } else {
      setStatusText(`Using appointment ID: ${trimmed}`);
    }
  };

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
      } catch {}
    }
    prevUrlRef.current = audioUrl || null;

    setPlayerTimeText("0:00 / 0:00");
    setPlayerSeek(0);
    setPlayerIsPlaying(false);

    if (!audioUrl) return;

    try {
      audio.currentTime = 0;
      audio.load();
      updatePlayerUIFromAudio();
    } catch {}

    audio
      .play()
      .then(() => setPlayerIsPlaying(true))
      .catch(() => setPlayerIsPlaying(false));
  }, [audioUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = playerSpeed;
  }, [playerSpeed]);

  useEffect(() => {
    if (!playerIsPlaying) return;
    const t = setInterval(() => {
      updatePlayerUIFromAudio();
    }, 250);
    return () => clearInterval(t);
  }, [playerIsPlaying]);

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

  const handlePlayerSpeedDown = () =>
    setPlayerSpeed((s) => Math.max(0.5, +(s - 0.1).toFixed(2)));
  const handlePlayerSpeedUp = () =>
    setPlayerSpeed((s) => Math.min(3.0, +(s + 0.1).toFixed(2)));

  const handleSelectRecording = async (record) => {
    hardResetAudio();
    setAudioUrl(null);
    setSelectedRecording(record);
    setPlayerVisible(true);

    setPlayerTitle(record.appointmentId || "(no appointment)");
    const dateStr = new Date(record.createdAt).toLocaleString();
    const cloudLabel = record.source === "cloud" ? " — Cloud recording" : "";
    setPlayerMeta(`${dateStr}${cloudLabel}`);

    try {
      if (record.source === "local" && record.local?.blob) {
        const url = URL.createObjectURL(record.local.blob);
        setAudioUrl(url);
        setStatusText("Playing local recording.");
        return;
      }

      if (record.source === "cloud" && record.cloud?.s3Key && idToken) {
        setStatusText("Fetching audio from cloud…");
        const data = await getPlaybackUrl(idToken, { s3Key: record.cloud.s3Key });
        if (!data.playbackUrl) throw new Error("No playbackUrl returned");

        const sep = data.playbackUrl.includes("?") ? "&" : "?";
        setAudioUrl(`${data.playbackUrl}${sep}cb=${Date.now()}`);

        setStatusText("Playing cloud recording.");
        return;
      }

      setStatusText("Unable to play this recording (missing data).");
    } catch (err) {
      console.error("Cloud playback error", err);
      setStatusText("Unable to play cloud recording: " + err.message);
    }
  };

  const handlePreviewRecording = (item) => {
    hardResetAudio();
    setAudioUrl(null);
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
    if (!appointmentId) {
      setStatusText(
        "Set an Appointment ID before starting so the status update can be sent to Salesforce."
      );
      return;
    }

    try {
      console.log("[SF START] tapped", {
        appointmentId,
        online: navigator.onLine,
        hasToken: !!idToken,
        userSub: user?.sub,
      });

      setStatusText("Sending Salesforce status update (START)…");

      await queueSfEvent({
        appointmentId,
        eventType: "START",
        statusValue: "In Progress",
        occurredAt: new Date().toISOString(),
      });

      if (navigator.onLine) {
        await syncSfPending();
      }

      setStatusText("Salesforce status update sent.");
    } catch (e) {
      console.warn("[SF START] failed", e);
      setStatusText(
        "Salesforce status update failed (will retry when you sync / go online): " +
          (e?.message || String(e))
      );
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

  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => {
      setStatusText((prev) =>
        prev ||
        "Still loading… If this doesn’t resolve, check Xcode console for [boot] href and auth errors (Safari Web Inspector can also show console/network)."
      );
    }, 6000);
    return () => clearTimeout(t);
  }, [loading]);

  // ==== LOADING / AUTH GUARD ====
  if (loading) {
    return (
      <div className="c-main">
        <p>Loading…</p>
        {statusText ? <p style={{ opacity: 0.8 }}>{statusText}</p> : null}
      </div>
    );
  }

  if (!isAuthenticated) {
    return <SignInRedirect statusText={statusText} onLogin={login} />;
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
          src={audioUrl}
          onLoadedMetadata={updatePlayerUIFromAudio}
          onTimeUpdate={updatePlayerUIFromAudio}
          onDurationChange={updatePlayerUIFromAudio}
          onEnded={() => {
            setPlayerIsPlaying(false);
            updatePlayerUIFromAudio();
          }}
          onPlay={() => {
            setPlayerIsPlaying(true);
            updatePlayerUIFromAudio();
          }}
          onPause={() => {
            setPlayerIsPlaying(false);
            updatePlayerUIFromAudio();
          }}
        />
        <footer className="c-footer">
          <span id="networkStatus">{networkStatus}</span>
        </footer>
      </div>
    </div>
  );
}

export default App;