// src/components/AudioPlayer.jsx
import React from "react";

function AudioPlayer({
  visible,
  title,
  meta,
  timeText,
  speedText,
  seekValue,
  isPlaying,
  onPlayPause,
  onSeek,
  onSpeedDown,
  onSpeedUp,
  audioRef,
  src,

  // ✅ NEW: audio event handlers
  onLoadedMetadata,
  onTimeUpdate,
  onDurationChange,
  onEnded,
  onPlay,
  onPause,
}) {
  if (!visible) return null;

  return (
    <section id="player" className="c-player">
      <div className="c-player__info">
        <div id="playerTitle" className="c-player__title">{title}</div>
        <div id="playerMeta" className="c-player__meta">{meta}</div>
      </div>

      <div className="c-player__controls">
        <button
          id="playerPlayPause"
          className="c-button c-button--brand"
          type="button"
          onClick={onPlayPause}
        >
          {isPlaying ? "⏸" : "▶"}
        </button>

        <input
          id="playerSeek"
          type="range"
          min="0"
          max="100"
          value={Number.isFinite(seekValue) ? seekValue : 0}
          onChange={(e) => onSeek(e.target.value)}
          className="c-player__seek"
        />

        <span id="playerTime" className="c-player__time">{timeText}</span>

        <div className="c-player__speed">
          <button className="c-button c-button--neutral" type="button" onClick={onSpeedDown}>
            -
          </button>
          <span id="playerSpeed" className="c-player__speed-label">{speedText}</span>
          <button className="c-button c-button--neutral" type="button" onClick={onSpeedUp}>
            +
          </button>
        </div>
      </div>

      <audio
        key={src || "empty"}        // keep remount behavior
        id="playerAudio"
        ref={audioRef}
        src={src || ""}
        preload="metadata"
        playsInline
        crossOrigin="anonymous"
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={onTimeUpdate}
        onDurationChange={onDurationChange}
        onEnded={onEnded}
        onPlay={onPlay}
        onPause={onPause}
      />
    </section>
  );
}

export default AudioPlayer;
