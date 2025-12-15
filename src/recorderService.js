// src/recorderService.js
import { Capacitor } from "@capacitor/core";
import { Filesystem } from "@capacitor/filesystem";

/**
 * IMPORTANT:
 * - We intentionally import these plugins as "namespace imports" (* as ...)
 *   to avoid Vite/Rolldown "Missing export" build errors.
 * - Then we resolve the actual plugin object at runtime.
 */

// --- helpers ---
export function isNative() {
  return Capacitor.isNativePlatform();
}
export function isAndroid() {
  return Capacitor.getPlatform() === "android";
}
export function isIOS() {
  return Capacitor.getPlatform() === "ios";
}

function resolveExport(ns, names) {
  for (const n of names) {
    if (ns && ns[n]) return ns[n];
  }
  // some libs ship default exports
  if (ns && ns.default) return ns.default;
  return null;
}

async function fileUrlToBlob(uri, fallbackMimeType = "audio/aac") {
  // 1) Try fetch (works for many file:// and http(s):// urls)
  try {
    const res = await fetch(uri);
    if (res.ok) {
      const blob = await res.blob();
      if (blob && blob.size > 0) return blob;
    }
  } catch (_) {
    // ignore, fallback below
  }

  // 2) Try Capacitor Filesystem.readFile
  //    Some plugins return file paths like:
  //    - file:///data/user/0/.../recording.m4a
  //    - /data/user/0/.../recording.m4a
  //    Filesystem.readFile expects a "path" without file://
  try {
    const path = uri.startsWith("file://") ? uri.replace("file://", "") : uri;

    const { data } = await Filesystem.readFile({ path });
    // data is base64
    const byteChars = atob(data);
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      byteNumbers[i] = byteChars.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: fallbackMimeType });
  } catch (e) {
    throw new Error(
      `Could not read recorded file as Blob. uri=${uri}. ${e?.message || e}`
    );
  }
}

// --- plugin resolvers (avoid named import build failures) ---
let _AudioRecorder = null;
async function getAudioRecorder() {
  if (_AudioRecorder) return _AudioRecorder;

  const ns = await import("@capgo/capacitor-audio-recorder");
  // Capgo docs show AudioRecorder, but your bundler complained about missing export.
  // So we resolve whichever name actually exists at runtime.
  _AudioRecorder = resolveExport(ns, [
    "AudioRecorder",
    "CapacitorAudioRecorder",
    "default",
  ]);

  if (!_AudioRecorder) {
    throw new Error(
      "Could not resolve AudioRecorder plugin export from @capgo/capacitor-audio-recorder"
    );
  }
  return _AudioRecorder;
}

let _ForegroundService = null;
async function getForegroundService() {
  if (_ForegroundService) return _ForegroundService;

  const ns = await import("@capawesome-team/capacitor-android-foreground-service");
  // Capawesome docs use ForegroundService :contentReference[oaicite:0]{index=0}
  _ForegroundService = resolveExport(ns, [
    "ForegroundService",
    "AndroidForegroundService",
    "default",
  ]);

  if (!_ForegroundService) {
    throw new Error(
      "Could not resolve ForegroundService plugin export from @capawesome-team/capacitor-android-foreground-service"
    );
  }
  return _ForegroundService;
}

/**
 * Native recorder:
 * - Uses @capgo/capacitor-audio-recorder
 * - On Android, starts a foreground service notification while recording
 *   (so recording continues when screen locks), then stops it afterwards. :contentReference[oaicite:1]{index=1}
 */
export function createNativeRecorder() {
  let lastBlob = null;
  let lastUri = null;
  let mimeType = "audio/aac"; // safe default; actual file format may differ by device/config

  async function startAndroidForegroundService() {
    if (!isAndroid()) return;
    const ForegroundService = await getForegroundService();

    // Minimal notification. You can customize channelId/name if you want.
    await ForegroundService.startForegroundService({
      id: 1001,
      title: "Recording in progress",
      body: "Audio recording is running. Tap to return to the app.",
    });
  }

  async function stopAndroidForegroundService() {
    if (!isAndroid()) return;
    const ForegroundService = await getForegroundService();
    await ForegroundService.stopForegroundService();
  }

  return {
    async init() {
      const AudioRecorder = await getAudioRecorder();

      // Capgo permission key shown as recordAudio in their docs :contentReference[oaicite:2]{index=2}
      const perm = await AudioRecorder.checkPermissions?.();
      if (perm?.recordAudio !== "granted") {
        const requested = await AudioRecorder.requestPermissions();
        if (requested?.recordAudio !== "granted") {
          throw new Error("Microphone permission not granted");
        }
      }
    },

    async start() {
      const AudioRecorder = await getAudioRecorder();

      lastBlob = null;
      lastUri = null;

      await startAndroidForegroundService();

      // Optional: pass options here if you want format/bitrate/sampleRate.
      await AudioRecorder.startRecording();
      return { mimeType };
    },

    async pause() {
      const AudioRecorder = await getAudioRecorder();
      if (typeof AudioRecorder.pauseRecording !== "function") {
        throw new Error("Pause not supported on native recorder");
      }
      await AudioRecorder.pauseRecording();
    },

    async resume() {
      const AudioRecorder = await getAudioRecorder();
      if (typeof AudioRecorder.resumeRecording !== "function") {
        throw new Error("Resume not supported on native recorder");
      }
      await AudioRecorder.resumeRecording();
    },

    async stop() {
      const AudioRecorder = await getAudioRecorder();

      const result = await AudioRecorder.stopRecording();

      // Capgo docs show: result.filePath + result.duration :contentReference[oaicite:3]{index=3}
      const filePath = result?.filePath || result?.uri || result?.path;
      if (!filePath) {
        await stopAndroidForegroundService();
        throw new Error("stopRecording() returned no file path/uri");
      }

      lastUri = filePath;

      // Convert native file into Blob so your existing upload path stays the same
      lastBlob = await fileUrlToBlob(filePath, mimeType);

      await stopAndroidForegroundService();

      if (!lastBlob || lastBlob.size === 0) {
        throw new Error("Native recording blob is empty");
      }

      return { blob: lastBlob, mimeType, uri: lastUri };
    },

    async cancel() {
      const AudioRecorder = await getAudioRecorder();
      if (typeof AudioRecorder.cancelRecording === "function") {
        await AudioRecorder.cancelRecording();
      }
      await stopAndroidForegroundService();
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

