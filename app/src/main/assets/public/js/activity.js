// Activity log: records and renders local events. Stored in IndexedDB via storage.js.
import { getLogs, saveLogs, clearLogs } from "./storage.js";
import { icon, formatTime, confirmDialog, toast, escapeHtml } from "./ui.js";

export async function logActivity(message, type = "info") {
  await saveLogs({ message, type, timestamp: Date.now() });
  document.dispatchEvent(new CustomEvent("activity:changed"));
}

export async function renderActivityPage(container) {
  const logs = await getLogs(200);
  container.innerHTML = `
    <div class="view-head" style="margin-bottom:14px">
      <div></div>
      <button class="btn btn-ghost btn-sm" id="clear-log-btn">Clear Log</button>
    </div>
    <div class="card" id="activity-list"></div>
  `;
  renderList(container.querySelector("#activity-list"), logs);

  container.querySelector("#clear-log-btn").addEventListener("click", async () => {
    const confirmed = await confirmDialog({
      title: "Clear activity log?",
      message: "This removes all locally stored activity history. This can't be undone.",
      confirmLabel: "Clear",
      danger: true,
    });
    if (confirmed) {
      await clearLogs();
      toast("Activity log cleared");
      renderActivityPage(container);
    }
  });
}

function renderList(el, logs) {
  if (!logs.length) {
    el.innerHTML = `<div class="empty-state">${icon("empty")}<p>No activity yet. Actions you take will show up here.</p></div>`;
    return;
  }
  el.innerHTML = logs
    .map(
      (l) => `
    <div class="activity-item">
      <div class="dot-wrap">${icon("activity")}</div>
      <div>
        <div class="msg">${escapeHtml(l.message)}</div>
        <div class="time">${formatTime(l.timestamp)}</div>
      </div>
    </div>`
    )
    .join("");
}

export async function renderRecentActivityWidget(container, limit = 4) {
  const logs = await getLogs(limit);
  if (!logs.length) {
    container.innerHTML = `<div class="empty-state">${icon("empty")}<p>No activity yet.</p></div>`;
    return;
  }
  container.innerHTML = logs
    .map(
      (l) => `
    <div class="activity-item">
      <div class="dot-wrap">${icon("activity")}</div>
      <div>
        <div class="msg">${escapeHtml(l.message)}</div>
        <div class="time">${formatTime(l.timestamp)}</div>
      </div>
    </div>`
    )
    .join("");
}
