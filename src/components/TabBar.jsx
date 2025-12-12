// src/components/TabBar.jsx
import React from "react";

function TabBar({ activeTab, onTabChange }) {
  const isNew = activeTab === "new";

  return (
    <div className="c-tabs" role="tablist" aria-label="Recording tabs">
      <button
        id="tabNewBtn"
        role="tab"
        aria-selected={isNew ? "true" : "false"}
        aria-controls="tabNewPanel"
        className={
          "c-tabs__tab" + (isNew ? " c-tabs__tab--active" : "")
        }
        type="button"
        onClick={() => onTabChange("new")}
      >
        New recording
      </button>

      <button
        id="tabListBtn"
        role="tab"
        aria-selected={!isNew ? "true" : "false"}
        aria-controls="tabListPanel"
        className={
          "c-tabs__tab" + (!isNew ? " c-tabs__tab--active" : "")
        }
        type="button"
        onClick={() => onTabChange("list")}
      >
        My recordings
      </button>
    </div>
  );
}

export default TabBar;
