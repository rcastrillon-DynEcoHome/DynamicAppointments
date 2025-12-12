import React, { useEffect, useRef, useState } from "react";

function NewRecordingPanel({
  isActive,
  appointmentDisplayText,
  onAppointmentClick,
  statusText,
  onStatusChange,
  onBannerChange,
  appointmentId,
  onSaveRecording,
  onSaved,
  onMarkStart,        // optional SF hook
  onMarkSave,         // optional SF hook
  onPreviewRecording, // required for shared footer player
}) {
  const [isSupported, setIsSupported] = useState(true);
  const [recorderState, setRecorderState] = useState("inactive");
  // "inactive" | "recording" | "paused" | "file"

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]); // collected chunks

  const [audioBlob, setAudioBlob] = useState(null);
  const [recordingMimeType, setRecordingMimeType] = useState("");

  // scrapping tracking: state (for UI) + ref (for onstop correctness)
  const [isScrapping, setIsScrapping] = useState(false);
  const isScrappingRef = useRef(false);

  // Button states
  const [startDisabled, setStartDisabled] = useState(false);
  const [pauseDisabled, setPauseDisabled] = useState(true);
  const [resumeDisabled, setResumeDisabled] = useState(true);
  const [stopDisabled, setStopDisabled] = useState(true);
  const [saveDisabled, setSaveDisabled] = useState(true);
  const [scrapDisabled, setScrapDisabled] = useState(true);
  const [previewDisabled, setPreviewDisabled] = useState(true);

  const fileInputRef = useRef(null);

  async function getAudioDuration(blob) {
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

  // Helper to build the preview item
  // Uses chunks for live recordings; final blob for stopped/file
  async function buildCurrentPreviewItem() {
    const chunks = audioChunksRef.current || [];
    let blob = null;

    if (recorderState === "recording" || recorderState === "paused") {
      if (!chunks.length) {
        // fallback: if somehow no chunks yet
        blob = audioBlob || null;
      } else {
        const type = recordingMimeType || "audio/mp4";
        blob = new Blob(chunks, { type });
      }
    } else {
      // stopped or file mode
      blob = audioBlob;
      if (!blob && chunks.length) {
        const type = recordingMimeType || "audio/mp4";
        blob = new Blob(chunks, { type });
        setAudioBlob(blob);
      }
    }

    if (!blob || blob.size === 0) {
      return null;
    }

    const durationSeconds = await getAudioDuration(blob);

    return {
      appointmentId: appointmentId || "(unsaved)",
      createdAt: new Date().toISOString(),
      blob,
      durationSeconds,
    };
  }

  // ----- Browser support check -----
  useEffect(() => {
    if (typeof MediaRecorder === "undefined") {
      setIsSupported(false);
      onStatusChange?.(
        "Recording is not supported on this browser. You can still upload audio files."
      );
    }
  }, [onStatusChange]);

  // ----- MediaRecorder init -----
  async function initMedia() {
    if (typeof MediaRecorder === "undefined") {
      throw new Error("MediaRecorder not supported");
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    let mimeType = "";
    if (MediaRecorder.isTypeSupported("audio/mp4")) {
      mimeType = "audio/mp4";
    } else if (MediaRecorder.isTypeSupported("audio/webm")) {
      mimeType = "audio/webm";
    } else if (MediaRecorder.isTypeSupported("audio/aac")) {
      mimeType = "audio/aac";
    }

    setRecordingMimeType(mimeType || "");

    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        audioChunksRef.current.push(e.data);
      }
    };

    recorder.onstop = () => {
      // 🔑 use ref so we see the *actual* current scrapping flag
      const wasScrapping = isScrappingRef.current;
      isScrappingRef.current = false;
      setIsScrapping(false);

      const chunks = audioChunksRef.current || [];
      audioChunksRef.current = [];
      setRecorderState("inactive");

      if (wasScrapping) {
        // SCRAP of active recording: full reset here
        setAudioBlob(null);
        setSaveDisabled(true);
        setStartDisabled(false);
        setPauseDisabled(true);
        setResumeDisabled(true);
        setStopDisabled(true);
        setScrapDisabled(true);
        setPreviewDisabled(true);

        onStatusChange?.("Recording discarded.");
        onBannerChange?.("hidden"); // 👈 hide banner after scrap
      } else {
        // Normal stop: build the final blob from all chunks
        if (!chunks.length) {
          console.warn("No audio chunks collected on stop.");
          setAudioBlob(null);
          setSaveDisabled(true);
          setStartDisabled(false);
          setPauseDisabled(true);
          setResumeDisabled(true);
          setStopDisabled(true);
          setScrapDisabled(true);
          setPreviewDisabled(true);

          onStatusChange?.(
            "No audio captured. Please try recording again."
          );
          onBannerChange?.("hidden");
        } else {
          const type = recordingMimeType || "audio/mp4";
          const blob = new Blob(chunks, { type });
          setAudioBlob(blob);

          onStatusChange?.(
            "Recording ready. Tap 'Save recording' to keep it."
          );
          setSaveDisabled(false);
          setStartDisabled(false);
          setPauseDisabled(true);
          setResumeDisabled(true);
          setStopDisabled(true);
          setScrapDisabled(false);
          setPreviewDisabled(false); // preview after stop

          onBannerChange?.("ready");
        }
      }

      try {
        if (recorder.stream) {
          recorder.stream.getTracks().forEach((t) => t.stop());
        }
      } catch (e) {
        console.warn("Error stopping media tracks", e);
      }

      mediaRecorderRef.current = null;
    };

    mediaRecorderRef.current = recorder;
  }

  // ----- SCRAP -----
  async function handleScrap() {
    if (scrapDisabled) return;

    const recorder = mediaRecorderRef.current;
    const state = recorder ? recorder.state : "inactive";
    const hasBlob = !!audioBlob;
    const hasChunks = audioChunksRef.current.length > 0;

    if (!hasBlob && !hasChunks && state === "inactive") {
      onStatusChange?.("No recording in progress to scrap.");
      setScrapDisabled(true);
      setPreviewDisabled(true);
      return;
    }

    const confirmed = window.confirm(
      "This will permanently delete this recording in progress. This action cannot be undone. Continue?"
    );
    if (!confirmed) return;

    // Case 1: Active recorder → let onstop handle cleanup
    if (state === "recording" || state === "paused") {
      isScrappingRef.current = true;
      setIsScrapping(true);
      try {
        recorder.stop();
      } catch (e) {
        console.warn("Error stopping recorder during scrap", e);
        isScrappingRef.current = false;
        setIsScrapping(false);
      }
      return;
    }

    // Case 2: No active recorder, but we have an unsaved blob/chunks
    audioChunksRef.current = [];
    setAudioBlob(null);
    setRecordingMimeType("");
    setRecorderState("inactive");

    setSaveDisabled(true);
    setStartDisabled(false);
    setPauseDisabled(true);
    setResumeDisabled(true);
    setStopDisabled(true);
    setScrapDisabled(true);
    setPreviewDisabled(true);

    onStatusChange?.("Recording discarded.");
    onBannerChange?.("hidden"); // 👈 hide banner after scrap
  }

  // ----- RECORDING CONTROLS -----

  async function handleStart() {
    try {
      if (!isSupported) {
        onStatusChange?.(
          "Recording is not supported on this browser. You can still upload audio files."
        );
        return;
      }

      if (!mediaRecorderRef.current) {
        await initMedia();
      }

      audioChunksRef.current = [];
      setAudioBlob(null);
      isScrappingRef.current = false;
      setIsScrapping(false);

      // 1-second chunks so preview always has data
      mediaRecorderRef.current.start(1000);

      setRecorderState("recording");

      onStatusChange?.("Recording…");
      onBannerChange?.("recording");

      setStartDisabled(true);
      setPauseDisabled(false);
      setResumeDisabled(true);
      setStopDisabled(false);
      setSaveDisabled(true);
      setScrapDisabled(false);
      setPreviewDisabled(true); // no preview while recording

      if (onMarkStart && appointmentId) {
        try {
          await onMarkStart();
        } catch (e) {
          console.warn("Failed to queue SF START event", e);
        }
      }
    } catch (err) {
      console.error("Error starting recording", err);
      onStatusChange?.("Error starting recording: " + err.message);
      onBannerChange?.("hidden");
    }
  }

  function handlePause() {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === "recording") {
      recorder.pause();
      setRecorderState("paused");
      onStatusChange?.("Recording paused.");
      onBannerChange?.("paused");
      setPauseDisabled(true);
      setResumeDisabled(false);
      setPreviewDisabled(false); // allow preview while paused
    }
  }

  function handleResume() {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === "paused") {
      recorder.resume();
      setRecorderState("recording");
      onStatusChange?.("Recording resumed.");
      onBannerChange?.("recording");
      setResumeDisabled(true);
      setPauseDisabled(false);
      setPreviewDisabled(true); // back to disabled while recording
    }
  }

  function handleStop() {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    if (recorder.state === "recording" || recorder.state === "paused") {
      recorder.stop();
      onStatusChange?.("Stopping recording…");
      setPauseDisabled(true);
      setResumeDisabled(true);
      setStopDisabled(true);
      // preview state decided in onstop
    }
  }

  // ----- FILE LOAD -----

  function handleFileButton() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    audioChunksRef.current = [];
    setAudioBlob(file);
    setRecordingMimeType(file.type || "");
    isScrappingRef.current = false;
    setIsScrapping(false);
    setRecorderState("file");

    const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
    onStatusChange?.(
      `Loaded audio file: ${file.name} (${sizeMb} MB). Tap 'Save recording' to store it locally.`
    );

    setSaveDisabled(false);
    setStartDisabled(false);
    setPauseDisabled(true);
    setResumeDisabled(true);
    setStopDisabled(true);
    setScrapDisabled(false);
    setPreviewDisabled(false); // preview allowed for loaded file
    onBannerChange?.("ready");
  }

  // ----- PREVIEW → SHARED FOOTER PLAYER -----

  async function handlePreview() {
    if (previewDisabled) return;

    const recorder = mediaRecorderRef.current;
    const state = recorder ? recorder.state : "inactive";

    // Do not allow preview while actively recording
    if (state === "recording") {
      onStatusChange?.("Pause or stop the recording before previewing.");
      return;
    }

    // If paused, flush buffer so chunks include latest audio
    if (recorder && state === "paused") {
      try {
        recorder.requestData();
      } catch (e) {
        console.warn("requestData failed in preview", e);
      }
      // tiny delay to let ondataavailable fire
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const item = await buildCurrentPreviewItem();
    if (!item) {
      onStatusChange?.("Nothing to preview yet.");
      return;
    }

    if (onPreviewRecording) {
      onPreviewRecording(item);
      onStatusChange?.("Previewing current recording (not yet saved).");
    } else {
      onStatusChange?.(
        "Preview player not available. (Missing onPreviewRecording handler.)"
      );
    }
  }

  // ----- SAVE -----

  async function handleSave() {
    if (!audioBlob) {
      onStatusChange?.("No recording to save.");
      return;
    }
    if (!appointmentId) {
      onStatusChange?.("Please set an appointment ID before saving.");
      return;
    }

    const durationSeconds = await getAudioDuration(audioBlob);

    const savedRecord = await onSaveRecording({
      blob: audioBlob,
      appointmentId,
      durationSeconds,
    });

    if (onMarkSave && savedRecord) {
      try {
        await onMarkSave(savedRecord);
      } catch (e) {
        console.warn("Failed to queue SF SAVE event", e);
      }
    }

    setSaveDisabled(true);
    setStartDisabled(false);
    setScrapDisabled(true);
    setPreviewDisabled(true);

    audioChunksRef.current = [];
    setAudioBlob(null);
    setRecordingMimeType("");
    setRecorderState("inactive");

    // 👇 always hide banner after save
    onBannerChange?.("hidden");

    onStatusChange?.(
      navigator.onLine
        ? "Recording saved on device. Uploading now…"
        : "Recording saved on device. It will upload when you are back online."
    );

    onSaved?.();
  }

  return (
    <section
      id="tabNewPanel"
      role="tabpanel"
      aria-labelledby="tabNewBtn"
      className="c-card c-card--primary"
      hidden={!isActive}
    >
      <h2 className="c-card__title">New Recording</h2>

      <div
        id="appointmentDisplay"
        className="c-appointment-display"
        title="Click to edit appointment ID"
        aria-label="Appointment ID. Click to edit."
        onClick={onAppointmentClick}
      >
        {appointmentDisplayText}
      </div>

      <p id="status" className="c-text-muted">
        {statusText}
      </p>

      <div className="c-button-row">
        <button
          id="startBtn"
          className="c-button c-button--brand"
          type="button"
          onClick={handleStart}
          disabled={startDisabled || !isSupported}
        >
          Start
        </button>
        <button
          id="pauseBtn"
          className="c-button"
          type="button"
          onClick={handlePause}
          disabled={pauseDisabled}
        >
          Pause
        </button>
        <button
          id="resumeBtn"
          className="c-button"
          type="button"
          onClick={handleResume}
          disabled={resumeDisabled}
        >
          Resume
        </button>
        <button
          id="stopBtn"
          className="c-button c-button--destructive"
          type="button"
          onClick={handleStop}
          disabled={stopDisabled}
        >
          Stop
        </button>
      </div>

      <div className="c-button-row c-button-row--secondary">
        <button
          id="saveBtn"
          className="c-button c-button--neutral"
          type="button"
          onClick={handleSave}
          disabled={saveDisabled}
        >
          Save recording
        </button>
        <button
          id="previewBtn"
          className="c-button c-button--neutral"
          type="button"
          onClick={handlePreview}
          disabled={previewDisabled}
        >
          Preview
        </button>
        <button
          id="fileBtn"
          className="c-button"
          type="button"
          onClick={handleFileButton}
        >
          Use audio file
        </button>
        <input
          ref={fileInputRef}
          id="fileInput"
          type="file"
          accept="audio/*"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
      </div>

      <div className="c-button-row c-button-row--secondary">
        <button
          id="scrapBtn"
          className="c-button c-button--destructive"
          type="button"
          onClick={handleScrap}
          disabled={scrapDisabled}
        >
          Scrap recording
        </button>
      </div>

      <p className="c-text-small">
        This app works offline. Recordings are saved on your device and
        uploaded when you are online. You can also load an existing audio
        file and tag it to an appointment.
      </p>
    </section>
  );
}

export default NewRecordingPanel;
