// src/recorderService.js
import { Capacitor } from "@capacitor/core";

/** --- platform helpers --- */
export function isNative() {
  return Capacitor.isNativePlatform();
}
export function isAndroid() {
  return Capacitor.getPlatform() === "android";
}
export function isIOS() {
  return Capacitor.getPlatform() === "ios";
}

/** --- small helpers --- */
function safeJsonParse(maybeJson) {
  if (typeof maybeJson !== "string") return maybeJson;
  try {
    return JSON.parse(maybeJson);
  } catch {
    return maybeJson;
  }
}

async function getCapFilesystem() {
  if (!Capacitor.isNativePlatform()) return null;
  const mod = await import("@capacitor/filesystem");
  return mod.Filesystem;
}

function base64ToBlob(base64, mimeType) {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
  return new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
}

/**
 * Convert a native recorder URI into a Blob.
 *
 * iOS:
 * - fetch(file://...) fails (WebKit restriction)
 * - Filesystem.readFile() supports full file:// paths IF you omit `directory`
 *   (Capacitor docs explicitly call this out). :contentReference[oaicite:1]{index=1}
 *
 * Strategy:
 *  1) Filesystem.readFile({ path: "file://..." })  ✅ best for iOS tmp paths
 *  2) fetch(Capacitor.convertFileSrc(uri))         ✅ sometimes works too
 */
async function nativeUriToBlob(uri, mimeType) {
  if (!uri || typeof uri !== "string") {
    throw new Error(`nativeUriToBlob: invalid uri: ${String(uri)}`);
  }

  // Normalize to a proper file:// URI if we were given a raw /private/... path
  const fileUri = uri.startsWith("file://") ? uri : uri.startsWith("/") ? `file://${uri}` : uri;

  // --- 1) BEST PATH (iOS): read full file:// path via Filesystem with NO directory ---
  try {
    const Filesystem = await getCapFilesystem();
    if (!Filesystem?.readFile) throw new Error("Filesystem plugin not available");

    const { data } = await Filesystem.readFile({ path: fileUri });
    if (!data) throw new Error("Filesystem.readFile returned empty data");
    return base64ToBlob(data, mimeType || "audio/m4a");
  } catch (e) {
    // continue to fallback
    // console.warn("[Recorder] Filesystem.readFile(full file://) failed:", e);
  }

  // --- 2) fallback: convertFileSrc + fetch ---
  // NOTE: convertFileSrc exists specifically to make native file paths webview-friendly.
  // Docs: Capacitor.convertFileSrc rewrites device paths for the webview. :contentReference[oaicite:2]{index=2}
  const converted = Capacitor.convertFileSrc(fileUri);

  // Some environments return capacitor://localhost/... which certain fetch stacks dislike.
  // If that happens, trying http://localhost/... can help.
  const convertedHttp = converted.startsWith("capacitor://localhost/")
    ? converted.replace("capacitor://localhost/", "http://localhost/")
    : converted;

  for (const candidate of [converted, convertedHttp]) {
    try {
      const res = await fetch(candidate);
      if (!res.ok) continue;
      const blob = await res.blob();
      if (blob && blob.size > 0) return blob;
    } catch {
      // keep trying
    }
  }

  throw new Error(
    `Could not read recorded file as Blob.\n` +
      `uri=${uri}\n` +
      `fileUri=${fileUri}\n` +
      `convertFileSrc=${converted}\n`
  );
}

/** --- resolve AudioRecorder plugin robustly (Capacitor registry first) --- */
let _AudioRecorder = null;
async function getAudioRecorderPlugin() {
  if (_AudioRecorder) return _AudioRecorder;

  // Your logs show pluginId: "CapacitorAudioRecorder"
  const fromRegistry =
    Capacitor?.Plugins?.CapacitorAudioRecorder ||
    Capacitor?.Plugins?.AudioRecorder ||
    Capacitor?.Plugins?.CapgoCapacitorAudioRecorder ||
    null;

  if (fromRegistry) {
    _AudioRecorder = fromRegistry;
    return _AudioRecorder;
  }

  throw new Error(
    "AudioRecorder plugin not found in Capacitor.Plugins. Ensure @capgo/capacitor-audio-recorder is installed and run: npx cap sync ios"
  );
}

/** --- Android foreground service (optional) --- */
let _ForegroundService = null;
async function getForegroundServicePlugin() {
  if (_ForegroundService) return _ForegroundService;

  const fromRegistry =
    Capacitor?.Plugins?.ForegroundService ||
    Capacitor?.Plugins?.AndroidForegroundService ||
    null;

  if (fromRegistry) {
    _ForegroundService = fromRegistry;
    return _ForegroundService;
  }

  try {
    const ns = await import(
      /* @vite-ignore */ "@capawesome-team/capacitor-android-foreground-service"
    );
    _ForegroundService =
      ns?.ForegroundService || ns?.AndroidForegroundService || ns?.default || null;
    return _ForegroundService;
  } catch {
    return null; // optional
  }
}

async function startAndroidForegroundService() {
  if (!isAndroid()) return;
  const ForegroundService = await getForegroundServicePlugin();
  if (!ForegroundService?.startForegroundService) return;

  await ForegroundService.startForegroundService({
    id: 1001,
    title: "Recording in progress",
    body: "Audio recording is running. Tap to return to the app.",
  });
}

async function stopAndroidForegroundService() {
  if (!isAndroid()) return;
  const ForegroundService = await getForegroundServicePlugin();
  if (!ForegroundService?.stopForegroundService) return;

  await ForegroundService.stopForegroundService();
}

/** --- Web recorder fallback (MediaRecorder) --- */
function createWebRecorder() {
  let mediaRecorder = null;
  let chunks = [];
  let stream = null;

  let lastBlob = null;
  let lastUri = null;
  let mimeType = "audio/webm";

  function cleanupStream() {
    if (stream) {
      try {
        stream.getTracks().forEach((t) => t.stop());
      } catch {}
    }
    stream = null;
  }

  return {
    async init() {},

    async start() {
      lastBlob = null;
      lastUri = null;
      chunks = [];

      stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const candidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/ogg",
      ];
      mimeType =
        candidates.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) ||
        "audio/webm";

      mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.start();
      return { mimeType };
    },

    async pause() {
      if (!mediaRecorder) throw new Error("No active recording");
      if (mediaRecorder.state === "recording") mediaRecorder.pause();
    },

    async resume() {
      if (!mediaRecorder) throw new Error("No active recording");
      if (mediaRecorder.state === "paused") mediaRecorder.resume();
    },

    async stop() {
      if (!mediaRecorder) throw new Error("No active recording");

      await new Promise((resolve) => {
        mediaRecorder.onstop = resolve;
        mediaRecorder.stop();
      });

      cleanupStream();

      lastBlob = new Blob(chunks, { type: mimeType });
      chunks = [];
      mediaRecorder = null;

      if (!lastBlob || lastBlob.size === 0) throw new Error("Web recording blob is empty");
      return { blob: lastBlob, mimeType, uri: lastUri };
    },

    async cancel() {
      try {
        if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
      } catch {}
      cleanupStream();
      mediaRecorder = null;
      chunks = [];
      lastBlob = null;
      lastUri = null;
    },

    async getLastBlob() {
      return lastBlob;
    },

    async getLastUri() {
      return lastUri;
    },
  };
}

/** --- Native recorder --- */
export function createNativeRecorder() {
  let lastBlob = null;
  let lastUri = null;
  let isRecording = false;

  // iOS recordings from this plugin are typically m4a
  const defaultMime = isIOS() ? "audio/m4a" : "audio/aac";

  return {
    async init() {
      const AudioRecorder = await getAudioRecorderPlugin();

      const perm = await AudioRecorder.checkPermissions?.();
      if (perm?.microphone !== "granted" && perm?.recordAudio !== "granted") {
        const requested = await AudioRecorder.requestPermissions?.();
        const ok =
          requested?.microphone === "granted" || requested?.recordAudio === "granted";
        if (!ok) throw new Error("Microphone permission not granted");
      }
    },

    async start() {
      const AudioRecorder = await getAudioRecorderPlugin();
      lastBlob = null;
      lastUri = null;

      await startAndroidForegroundService();

      try {
        await AudioRecorder.startRecording();
        isRecording = true;
        return { mimeType: defaultMime };
      } catch (e) {
        await stopAndroidForegroundService();
        isRecording = false;
        throw e;
      }
    },

    async pause() {
      const AudioRecorder = await getAudioRecorderPlugin();
      if (typeof AudioRecorder.pauseRecording !== "function") {
        throw new Error("Pause not supported on native recorder");
      }
      await AudioRecorder.pauseRecording();
    },

    async resume() {
      const AudioRecorder = await getAudioRecorderPlugin();
      if (typeof AudioRecorder.resumeRecording !== "function") {
        throw new Error("Resume not supported on native recorder");
      }
      await AudioRecorder.resumeRecording();
    },

    async stop() {
      const AudioRecorder = await getAudioRecorderPlugin();

      try {
        const raw = await AudioRecorder.stopRecording();
        const result = safeJsonParse(raw);

        // Find a URI-like field robustly
        const uri =
          result?.uri || result?.filePath || result?.path || result?.webPath || null;

        if (!uri) throw new Error("stopRecording() returned no uri/filePath/path");

        lastUri = uri;

        // ✅ iOS-safe: read the file via Filesystem using full file:// when possible
        lastBlob = await nativeUriToBlob(uri, defaultMime);

        if (!lastBlob || lastBlob.size === 0) throw new Error("Native recording blob is empty");

        return { blob: lastBlob, mimeType: defaultMime, uri: lastUri };
      } finally {
        isRecording = false;
        await stopAndroidForegroundService();
      }
    },

    async cancel() {
      try {
        const AudioRecorder = await getAudioRecorderPlugin();
        if (typeof AudioRecorder.cancelRecording === "function" && isRecording) {
          await AudioRecorder.cancelRecording();
        }
      } finally {
        isRecording = false;
        await stopAndroidForegroundService();
        lastBlob = null;
        lastUri = null;
      }
    },

    async getLastBlob() {
      return lastBlob;
    },

    async getLastUri() {
      return lastUri;
    },
  };
}

/** --- Optional convenience factory --- */
export function createRecorder() {
  return isNative() ? createNativeRecorder() : createWebRecorder();
}
