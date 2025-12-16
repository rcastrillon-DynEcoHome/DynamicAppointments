import React from "react";
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
  return (
    <header className="c-header">
      <div className="c-header__left">
        <div className="c-header__title">Dynamic Eco Home Appointments</div>
        <div className="c-header__user" id="userDisplay">
          {userDisplay}
        </div>
      </div>

      <div className="c-header__actions">
        <button
          id="settingsBtn"
          className="c-icon-button"
          aria-haspopup="true"
          aria-expanded={isSettingsOpen ? "true" : "false"}
          type="button"
          onClick={onSettingsClick}
        >
          ⚙ Settings
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
