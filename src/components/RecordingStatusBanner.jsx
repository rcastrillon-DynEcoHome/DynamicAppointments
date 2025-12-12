// src/components/RecordingStatusBanner.jsx
import React from "react";

function RecordingStatusBanner({ state }) {
  let bannerClass = "c-recording-banner";
  let text = "";

  switch (state) {
    case "recording":
      bannerClass += " c-recording-banner--recording";
      text = "Recording in progress";
      break;
    case "paused":
      bannerClass += " c-recording-banner--paused";
      text = "Recording paused";
      break;
    case "ready":
      bannerClass += " c-recording-banner--ready";
      text = "Recording ready for saving";
      break;
    default:
      bannerClass += " c-recording-banner--hidden";
      text = "";
      break;
  }

  return (
    <div
      id="recordingStatusBanner"
      className={bannerClass}
      aria-live="polite"
    >
      {text}
    </div>
  );
}

export default RecordingStatusBanner;
