// src/hooks/useRecorder.js
import { useCallback, useRef, useState } from "react";

/**
 * useRecorder
 *
 * Wraps the browser MediaRecorder API.
 * Mirrors the behavior from your old app.js:
 * - Detects supported mimeType
 * - Handles start / pause / resume / stop
 * - Supports scrapping a recording
 * - Builds a final Blob on stop
 */

export function useRecorder() {
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const isScrappingRef = useRef(false);

  const [status, setStatus] = useState("idle"); // "idle" | "recording" | "paused" | "ready"
  const [blob, setBlob] = useState(null);
  const [mimeType, setMimeType] = useState("");
  const [error, setError] = useState(null);

  const initMedia = useCallback(async () => {
    if (typeof MediaRecorder === "undefined") {
      const msg =
        "Recording is not supported on this browser. You can still upload audio files.";
      setError(msg);
      throw new Error(msg);
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;

    let mType = "";
    if (MediaRecorder.isTypeSupported("audio/mp4")) {
      mType = "audio/mp4";
    } else if (MediaRecorder.isTypeSupported("audio/webm")) {
      mType = "audio/webm";
    } else if (MediaRecorder.isTypeSupported("audio/aac")) {
      mType = "audio/aac";
    }
    setMimeType(mType);

    const recorder = mType
      ? new MediaRecorder(stream, { mimeType: mType })
      : new MediaRecorder(stream);

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    recorder.onstop = () => {
      const wasScrapping = isScrappingRef.current;
      isScrappingRef.current = false;

      // Always stop underlying tracks
      try {
        if (recorder.stream) {
          recorder.stream.getTracks().forEach((track) => track.stop());
        }
      } catch (e) {
        console.warn("Error stopping media tracks", e);
      }

      mediaRecorderRef.current = null;
      streamRef.current = null;

      if (wasScrapping) {
        // discard everything
        chunksRef.current = [];
        setBlob(null);
        setStatus("idle");
        return;
      }

      // Build Blob from chunks
      const type = mType || "audio/mp4";
      const finalBlob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      setBlob(finalBlob);
      setStatus("ready");
    };

    recorder.onerror = (e) => {
      console.error("MediaRecorder error", e);
      setError(e.error?.message || "Recording error");
    };

    mediaRecorderRef.current = recorder;
    return recorder;
  }, []);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setBlob(null);
      chunksRef.current = [];
      isScrappingRef.current = false;

      let recorder = mediaRecorderRef.current;
      if (!recorder) {
        recorder = await initMedia();
      }

      recorder.start();
      setStatus("recording");
    } catch (err) {
      console.error("Error starting recording", err);
      setError(err.message || "Error starting recording");
      setStatus("idle");
    }
  }, [initMedia]);

  const pauseRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === "recording") {
      recorder.pause();
      setStatus("paused");
    }
  }, []);

  const resumeRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === "paused") {
      recorder.resume();
      setStatus("recording");
    }
  }, []);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    if (
      recorder.state === "recording" ||
      recorder.state === "paused"
    ) {
      recorder.stop();
      // actual status change to "ready" happens in onstop
    }
  }, []);

  const scrapRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    const hasChunks = chunksRef.current.length > 0;
    const hasBlob = !!blob;
    const state = recorder ? recorder.state : "inactive";

    if (!hasBlob && !hasChunks && state === "inactive") {
      // nothing to scrap
      setStatus("idle");
      return;
    }

    isScrappingRef.current = true;

    if (recorder && (state === "recording" || state === "paused")) {
      try {
        recorder.stop();
      } catch (e) {
        console.warn("Error stopping recorder during scrap", e);
        isScrappingRef.current = false;
      }
    }

    // Clear state
    setBlob(null);
    chunksRef.current = [];
    setMimeType("");
    setStatus("idle");
  }, [blob]);

  /**
   * Used to mimic mediaRecorder.requestData() while paused before previewing.
   */
  const requestDataFlush = useCallback(() => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state !== "paused") {
        resolve();
        return;
      }

      try {
        recorder.requestData();
      } catch (e) {
        console.warn("requestData failed", e);
        resolve();
        return;
      }

      // Small timeout to let dataavailable fire
      setTimeout(resolve, 50);
    });
  }, []);

  /**
   * Load from an uploaded file instead of a live recording.
   */
  const loadFromFile = useCallback((file) => {
    // Stop any existing stream/recorder
    const recorder = mediaRecorderRef.current;
    if (recorder) {
      try {
        recorder.stop();
      } catch (e) {
        console.warn("Error stopping recorder before loading file", e);
      }
      mediaRecorderRef.current = null;
    }
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach((t) => t.stop());
      } catch (e) {
        console.warn("Error stopping stream tracks", e);
      }
      streamRef.current = null;
    }

    isScrappingRef.current = false;
    chunksRef.current = [];
    setError(null);
    setMimeType(file.type || "");
    setBlob(file);
    setStatus("ready");
  }, []);

  /**
   * Clear the current recording blob/state (e.g., after saving).
   */
  const clearRecording = useCallback(() => {
    setBlob(null);
    chunksRef.current = [];
    setMimeType("");
    setStatus("idle");
  }, []);

  const isRecording = status === "recording";
  const isPaused = status === "paused";
  const isReady = status === "ready";
  const hasBlob = !!blob;

  return {
    status,
    error,
    mimeType,
    blob,
    isRecording,
    isPaused,
    isReady,
    hasBlob,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    scrapRecording,
    requestDataFlush,
    loadFromFile,
    clearRecording,
  };
}
