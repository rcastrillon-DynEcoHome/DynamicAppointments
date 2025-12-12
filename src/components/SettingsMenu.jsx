import React from "react";

function SettingsMenu({
  isOpen,
  onSyncRecordings,
  onClearCache,
  onSignOut,
}) {
  const menuClass =
    "c-menu" + (isOpen ? "" : " c-menu--hidden");

  return (
    <div
      id="settingsMenu"
      className={menuClass}
      role="menu"
      aria-label="Settings menu"
    >
      <button
        id="syncRecordingsBtn"
        className="c-menu__item"
        type="button"
        role="menuitem"
        onClick={onSyncRecordings}
      >
        Sync recordings
      </button>
      <button
        id="clearCacheBtn"
        className="c-menu__item"
        type="button"
        role="menuitem"
        onClick={onClearCache}
      >
        Clear app cache
      </button>
      <button
        id="signOutBtn"
        className="c-menu__item"
        type="button"
        role="menuitem"
        onClick={onSignOut}
      >
        Sign out
      </button>
    </div>
  );
}

export default SettingsMenu;
