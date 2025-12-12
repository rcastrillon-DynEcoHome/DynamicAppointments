// src/components/RecordingsList.jsx
import React from "react";

function badgeClass(status) {
  switch (status) {
    case "pending":
      return "c-badge--pending";
    case "uploading":
      return "c-badge--uploading";
    case "uploaded":
      return "c-badge--uploaded";
    case "failed":
      return "c-badge--failed";
    default:
      return "";
  }
}

function transcriptBadgeClass(status) {
  switch (status) {
    case "COMPLETED":
      return "c-badge--transcript-ready";
    case "IN_PROGRESS":
      return "c-badge--transcript-progress";
    case "NONE":
      return "c-badge--transcript-none";
    default:
      return "c-badge--transcript-none";
  }
}

function transcriptStatusLabel(status) {
  switch (status) {
    case "COMPLETED":
      return "TRANSCRIPT";
    case "IN_PROGRESS":
      return "TRANSCRIBING";
    case "NONE":
    default:
      return "NO TRANSCRIPT";
  }
}

function RecordingsList({
  isActive,
  recordings,
  filterFrom,
  filterTo,
  filterStatus,
  filterDevice,
  setFilterFrom,
  setFilterTo,
  setFilterStatus,
  setFilterDevice,
  loading,
  message,
  deviceId,
  onUploadLocal,
  onDeleteLocal,
  onSelectRecording,
}) {
  const handleUploadClick = (e, rec) => {
    e.stopPropagation();
    if (rec.source === "local" && rec.local) {
      onUploadLocal(rec.local);
    }
  };

  const handleDeleteClick = (e, rec) => {
    e.stopPropagation();
    if (rec.source === "local" && rec.local) {
      onDeleteLocal(rec.local.id);
    }
  };

  return (
    <section
      id="tabListPanel"
      role="tabpanel"
      aria-labelledby="tabListBtn"
      className="c-card c-card--primary"
      hidden={!isActive}
    >
      <h2 className="c-card__title">My Recordings</h2>

      <div className="c-filters">
        <label className="c-filters__field">
          <span>From</span>
          <input
            type="date"
            id="filterFrom"
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
          />
        </label>

        <label className="c-filters__field">
          <span>To</span>
          <input
            type="date"
            id="filterTo"
            value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)}
          />
        </label>

        <label className="c-filters__field">
          <span>Status</span>
          <select
            id="filterStatus"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="">All</option>
            <option value="uploaded">Uploaded</option>
          </select>
        </label>

        <label className="c-filters__field">
          <span>Device</span>
          <select
            id="filterDevice"
            value={filterDevice}
            onChange={(e) => setFilterDevice(e.target.value)}
          >
            <option value="">All</option>
            <option value="this">This device</option>
          </select>
        </label>
      </div>

      {message && (
        <p className="c-text-small" style={{ marginBottom: "0.5rem" }}>
          {message}
        </p>
      )}

      {loading && <p>Loading recordings…</p>}

      <div id="cloudRecordingsList" className="c-list">
        {!loading && (!recordings || recordings.length === 0) && (
          <div>No recordings found for these filters.</div>
        )}

        {recordings.map((r) => {
          const dateStr = new Date(r.createdAt).toLocaleString();
          let durationStr = "";
          if (
            typeof r.durationSeconds === "number" &&
            !isNaN(r.durationSeconds)
          ) {
            const mins = Math.floor(r.durationSeconds / 60);
            const secs = Math.round(r.durationSeconds % 60)
              .toString()
              .padStart(2, "0");
            durationStr = ` • ${mins}:${secs} min`;
          }

          const deviceLabel =
            r.deviceId === deviceId
              ? "This device"
              : r.deviceId ||
                (r.source === "cloud" ? "Other device" : "This device");

          const transcriptStatus =
            r.transcriptionStatus ||
            (r.source === "cloud" ? "NONE" : "");

          return (
            <div
              key={r.id}
              className="c-list__item"
              onClick={() => onSelectRecording(r)}
            >
              <div className="c-badge-row">
                <span
                  className={`c-badge ${badgeClass(r.status)}`}
                >
                  {r.status.toUpperCase()}
                </span>
                {transcriptStatus && (
                  <span
                    className={`c-badge ${transcriptBadgeClass(
                      transcriptStatus
                    )}`}
                  >
                    {transcriptStatusLabel(transcriptStatus)}
                  </span>
                )}
              </div>

              <div className="c-list__meta">
                {dateStr}
                {durationStr} —{" "}
                {r.appointmentId || "(no appointment)"} — {deviceLabel}
              </div>

              <div className="c-list__buttons">
                {r.source === "local" && r.hasBlob && (
                  <>
                    <button
                      className="c-button c-button--brand"
                      type="button"
                      onClick={(e) => handleUploadClick(e, r)}
                      disabled={
                        r.status === "uploaded" || !navigator.onLine
                      }
                    >
                      Upload now
                    </button>
                    <button
                      className="c-button"
                      type="button"
                      onClick={(e) => handleDeleteClick(e, r)}
                    >
                      Delete
                    </button>
                  </>
                )}

                {r.source === "cloud" && (
                  <span className="c-text-small">Cloud recording</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default RecordingsList;
