// Electrical board monitoring: per-board voltage/power/energy, device grouping.
import { getBoards, saveBoards, getDevices } from "./storage.js";
import { icon, timeAgo, escapeHtml } from "./ui.js";
import { renderMiniDeviceRow } from "./devices.js";

let expanded = new Set();

export function getBoardsWithStats() {
  const boards = getBoards();
  const devices = getDevices();
  return boards.map((b) => {
    const boardDevices = devices.filter((d) => d.boardId === b.id);
    const activeCount = boardDevices.filter((d) => (d.type === "curtain" ? d.state === "OPEN" : d.type === "fan" ? d.speed > 0 : !!d.state)).length;
    const activePower = boardDevices.reduce((sum, d) => {
      const isOn = d.type === "curtain" ? d.state === "OPEN" : d.type === "fan" ? d.speed > 0 : !!d.state;
      return isOn ? sum + (d.power || 0) : sum;
    }, 0);
    return {
      ...b,
      devices: boardDevices,
      deviceCount: boardDevices.length,
      activeCount,
      power: b.online ? +(activePower + (b.basePower || 0)).toFixed(1) : 0,
    };
  });
}

export function updateBoardReadings(readings) {
  // readings: { [boardId]: { voltage, power, energyDelta } }
  const boards = getBoards();
  const updated = boards.map((b) => {
    const r = readings[b.id];
    if (!r || !b.online) return b;
    return {
      ...b,
      voltage: r.voltage,
      power: r.power,
      energy: +(b.energy + r.energyDelta).toFixed(5),
      lastUpdate: Date.now(),
    };
  });
  saveBoards(updated);
  document.dispatchEvent(new CustomEvent("boards:changed"));
  return updated;
}

export function getAggregateBoardStats() {
  const boards = getBoardsWithStats();
  const online = boards.filter((b) => b.online);
  const totalPower = online.reduce((s, b) => s + b.power, 0);
  const totalEnergy = boards.reduce((s, b) => s + b.energy, 0);
  const avgVoltage = online.length ? online.reduce((s, b) => s + b.voltage, 0) / online.length : 0;
  return {
    count: boards.length,
    totalPower: +totalPower.toFixed(1),
    totalEnergy: +totalEnergy.toFixed(3),
    avgVoltage: +avgVoltage.toFixed(1),
  };
}

let boardsRedraw = null;

export function renderBoardsPage(container) {
  function draw() {
    if (!container.isConnected || container.hidden) return;
    const boards = getBoardsWithStats();
    const agg = getAggregateBoardStats();

    container.innerHTML = `
      <div class="grid grid-3" style="margin-bottom:20px">
        <div class="metric"><div class="label">Total Power</div><div class="value">${agg.totalPower}<small>W</small></div></div>
        <div class="metric"><div class="label">Total Energy</div><div class="value">${agg.totalEnergy}<small>kWh</small></div></div>
        <div class="metric"><div class="label">Average Voltage</div><div class="value">${agg.avgVoltage}<small>V</small></div></div>
      </div>
      <div class="boards-grid">${boards.map(boardCardHtml).join("")}</div>
    `;

    container.querySelectorAll("[data-board-head]").forEach((head) => {
      head.addEventListener("click", () => {
        const id = head.dataset.boardHead;
        expanded.has(id) ? expanded.delete(id) : expanded.add(id);
        draw();
      });
    });
  }
  draw();
  if (boardsRedraw) {
    document.removeEventListener("boards:changed", boardsRedraw);
    document.removeEventListener("devices:changed", boardsRedraw);
  }
  boardsRedraw = draw;
  document.addEventListener("boards:changed", draw);
  document.addEventListener("devices:changed", draw);
}

function boardCardHtml(board) {
  const isOpen = expanded.has(board.id);
  return `
    <div class="board-card">
      <div class="board-card-head" data-board-head="${board.id}">
        <div>
          <div class="title-row">
            <span class="status-dot ${board.online ? "" : "off"}"></span>
            <h3>${escapeHtml(board.name)}</h3>
          </div>
          <div style="font-size:12px;color:var(--ink-faint);margin-top:4px">${board.online ? "Online" : "Offline"} · Updated ${timeAgo(board.lastUpdate)}</div>
        </div>
        <span class="chevron ${isOpen ? "open" : ""}">${icon("chevron")}</span>
      </div>
      <div class="board-stats">
        <div class="s"><div class="l">Voltage</div><div class="v">${board.online ? board.voltage.toFixed(1) : "—"} V</div></div>
        <div class="s"><div class="l">Power</div><div class="v">${board.power.toFixed(1)} W</div></div>
        <div class="s"><div class="l">Energy</div><div class="v">${board.energy.toFixed(3)} kWh</div></div>
      </div>
      <div class="board-card-foot">
        <span>${board.deviceCount} devices · ${board.activeCount} active</span>
        <button class="btn btn-ghost btn-sm" data-board-head="${board.id}">View Board</button>
      </div>
      <div class="board-devices ${isOpen ? "open" : ""}">
        ${board.devices.length ? board.devices.map(renderMiniDeviceRow).join("") : `<div style="color:var(--ink-faint);font-size:13px">No devices assigned to this board.</div>`}
      </div>
    </div>`;
}
