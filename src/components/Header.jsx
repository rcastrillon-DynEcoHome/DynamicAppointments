import React, { useEffect, useRef } from "react";
import SettingsMenu from "./SettingsMenu.jsx";

function Header({
  userDisplay,
  appointmentDisplay,
  onSettingsClick,
  isSettingsOpen,
  onSyncRecordings,
  onClearCache,
  onSignOut,
}) {
  const actionsRef = useRef(null);

  // 🔽 Close menu when clicking outside
  useEffect(() => {
    if (!isSettingsOpen) return;

    function handlePointerDown(e) {
      if (
        actionsRef.current &&
        !actionsRef.current.contains(e.target)
      ) {
        onSettingsClick(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [isSettingsOpen, onSettingsClick]);

  return (
    <header className="c-header">
      <div className="c-header__left">
        <div className="c-header__title">
          Dynamic Eco Home Appointments
        </div>
        <div className="c-header__user" id="userDisplay">
          {userDisplay}
        </div>
      </div>

      <div className="c-header__actions" ref={actionsRef}>
        <button
          id="settingsBtn"
          className="c-header__menu-btn"
          aria-label="Open settings menu"
          aria-haspopup="true"
          aria-expanded={isSettingsOpen ? "true" : "false"}
          type="button"
          onClick={() => onSettingsClick(!isSettingsOpen)}
        >
          <svg
            className="c-header__menu-icon"
            width="22"
            height="22"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              d="M4 7h16M4 12h16M4 17h16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>

        <SettingsMenu
          isOpen={isSettingsOpen}
          onSyncRecordings={onSyncRecordings}
          onClearCache={onClearCache}
          onSignOut={onSignOut}
        />
      </div>

      <div className="c-header__appointment" id="headerAppointment">
        {appointmentDisplay}
      </div>
    </header>
  );
}

export default Header;
