// Device control: state, rendering, and hardware command dispatch.
import { getDevices, saveDevices } from "./storage.js";
import { getConnectionStatus, BLE_STATUS, sendCommand, buildSwitchCommand, buildFanSpeedCommand, buildAcTemperatureCommand, buildCurtainCommand } from "./bluetooth.js";
import { icon, toast, formatTime, escapeHtml } from "./ui.js";
import { logActivity } from "./activity.js";

const AC_STEPS = [16, 18, 20, 22, 24, 25, 27, 30];

let uiState = { search: "", filter: "all", location: "all" };
let devicesRedraw = null;

export function getAllDevices() {
  return getDevices();
}

export function getDeviceStats() {
  const devices = getDevices();
  const active = devices.filter((d) => isDeviceActive(d)).length;
  return { total: devices.length, active, offline: devices.length - active };
}

export function getTotalDevicePower() {
  return getDevices().reduce((sum, d) => (isDeviceActive(d) ? sum + (d.power || 0) : sum), 0);
}

function isDeviceActive(d) {
  if (d.type === "curtain") return d.state === "OPEN" || d.state === "MOVING";
  if (d.type === "fan") return d.state && d.speed > 0;
  return !!d.state;
}

function updateDevice(id, patch) {
  const devices = getDevices();
  const idx = devices.findIndex((d) => d.id === id);
  if (idx === -1) return null;
  devices[idx] = { ...devices[idx], ...patch, lastUpdated: Date.now() };
  saveDevices(devices);
  document.dispatchEvent(new CustomEvent("devices:changed", { detail: devices[idx] }));
  return devices[idx];
}

async function dispatchHardware(commandString, device, actionLabel) {
  const status = getConnectionStatus().status;
  if (status === BLE_STATUS.CONNECTED) {
    const result = await sendCommand(commandString);
    if (!result.ok) {
      toast(`Hardware write failed; local demo state was updated (${result.reason})`);
    }
  }
  await logActivity(`${device.name} ${actionLabel}`);
}

export async function toggleDevice(id) {
  const devices = getDevices();
  const device = devices.find((d) => d.id === id);
  if (!device) return;

  if (device.type === "curtain") {
    const next = device.state === "OPEN" ? "CLOSED" : "OPEN";
    const cmd = buildCurtainCommand(device.boardId, device.switchId, next === "OPEN" ? "open" : "close");
    updateDevice(id, { state: next });
    await dispatchHardware(cmd, device, `set to ${next.toLowerCase()}`);
    return;
  }

  if (device.type === "fan") {
    const turningOn = !device.state;
    const speed = turningOn ? Math.max(1, device.speed || 1) : device.speed;
    const cmd = turningOn
      ? buildFanSpeedCommand(device.boardId, device.switchId, speed)
      : buildSwitchCommand(device.boardId, device.switchId, false);
    updateDevice(id, { state: turningOn, speed: turningOn ? speed : 0 });
    await dispatchHardware(cmd, device, turningOn ? "turned ON" : "turned OFF");
    return;
  }

  const next = !device.state;
  const cmd = buildSwitchCommand(device.boardId, device.switchId, next);
  updateDevice(id, { state: next });
  await dispatchHardware(cmd, device, next ? "turned ON" : "turned OFF");
}

export async function setFanSpeed(id, speed) {
  const devices = getDevices();
  const device = devices.find((d) => d.id === id);
  if (!device) return;
  const cmd =
    speed === 0
      ? buildSwitchCommand(device.boardId, device.switchId, false)
      : buildFanSpeedCommand(device.boardId, device.switchId, speed);
  updateDevice(id, { state: speed > 0, speed });
  await dispatchHardware(cmd, device, speed === 0 ? "turned OFF" : `set to Speed ${speed}`);
}

export async function adjustAcTemperature(id, direction) {
  const devices = getDevices();
  const device = devices.find((d) => d.id === id);
  if (!device) return;
  const idx = AC_STEPS.indexOf(device.temperature);
  const nextIdx = Math.min(AC_STEPS.length - 1, Math.max(0, (idx === -1 ? 3 : idx) + direction));
  const temp = AC_STEPS[nextIdx];
  const cmd = buildAcTemperatureCommand(device.boardId, device.switchId, temp);
  updateDevice(id, { temperature: temp });
  await dispatchHardware(cmd, device, `temperature changed to ${temp}°C`);
}

export async function setAcTemperature(id, temp) {
  const devices = getDevices();
  const device = devices.find((d) => d.id === id);
  if (!device) return;
  const cmd = buildAcTemperatureCommand(device.boardId, device.switchId, temp);
  updateDevice(id, { temperature: temp });
  await dispatchHardware(cmd, device, `temperature changed to ${temp}°C`);
}

export async function setCurtainAction(id, action) {
  const devices = getDevices();
  const device = devices.find((d) => d.id === id);
  if (!device) return;
  const stateMap = { open: "OPEN", close: "CLOSED", stop: "MOVING" };
  const cmd = buildCurtainCommand(device.boardId, device.switchId, action);
  updateDevice(id, { state: stateMap[action] });
  await dispatchHardware(cmd, device, `curtain ${action}`);
}

// ---------------- Rendering ----------------
export function deviceCardHtml(device) {
  const active = isDeviceActive(device);
  const powerLabel = active ? `${device.power} W` : "0 W";

  let controlHtml = `<button class="toggle" role="switch" aria-checked="${active}" aria-label="Toggle ${escapeHtml(device.name)}" data-toggle="${device.id}"></button>`;

  if (device.type === "fan") {
    controlHtml = `
      <div class="chip-row" data-fan="${device.id}">
        ${[0, 1, 2, 3]
          .map(
            (s) =>
              `<button class="chip ${device.speed === s ? "active" : ""}" data-speed="${s}">${s === 0 ? "Off" : "S" + s}</button>`
          )
          .join("")}
      </div>`;
  } else if (device.type === "ac") {
    controlHtml = `
      <div class="temp-control" data-ac="${device.id}">
        <button class="stepper-btn" data-dir="-1" aria-label="Decrease temperature">−</button>
        <strong>${device.temperature}°C</strong>
        <button class="stepper-btn" data-dir="1" aria-label="Increase temperature">+</button>
        <button class="toggle" role="switch" aria-checked="${device.state}" aria-label="Toggle ${escapeHtml(device.name)}" data-toggle="${device.id}" style="margin-left:8px"></button>
      </div>`;
  } else if (device.type === "curtain") {
    controlHtml = `
      <div class="chip-row" data-curtain="${device.id}">
        <button class="chip ${device.state === "OPEN" ? "active" : ""}" data-action="open">Open</button>
        <button class="chip ${device.state === "CLOSED" ? "active" : ""}" data-action="close">Close</button>
        <button class="chip ${device.state === "MOVING" ? "active" : ""}" data-action="stop">Stop</button>
      </div>`;
  }

  return `
    <div class="device-card ${active ? "" : "is-off"}" data-device-id="${device.id}">
      <div class="top-row">
        <div>
          <div class="icon-wrap">${icon(device.icon)}</div>
          <div class="name">${escapeHtml(device.name)}</div>
          <div class="loc">${escapeHtml(device.location)}</div>
        </div>
        ${device.type === "fan" || device.type === "curtain" || device.type === "ac" ? "" : controlHtml}
      </div>
      ${device.type === "fan" || device.type === "curtain" || device.type === "ac" ? controlHtml : ""}
      <div class="meta-row">
        <div>Power<b>${powerLabel}</b></div>
        <div style="text-align:right">Last updated<b>${formatTime(device.lastUpdated || Date.now())}</b></div>
      </div>
    </div>`;
}

export function renderDevicesPage(container) {
  const devices = getDevices();
  const locations = [...new Set(devices.map((d) => d.location))];

  container.innerHTML = `
    <div class="search-bar">
      ${icon("search")}
      <input type="text" placeholder="Search devices…" id="device-search" value="${escapeHtml(uiState.search)}" aria-label="Search devices" />
    </div>
    <div class="filter-row" id="status-filters">
      ${["all", "on", "off", "offline"]
        .map((f) => `<button class="chip ${uiState.filter === f ? "active" : ""}" data-filter="${f}">${f === "all" ? "All" : f.toUpperCase()}</button>`)
        .join("")}
    </div>
    <div class="filter-row" id="location-filters">
      <button class="chip ${uiState.location === "all" ? "active" : ""}" data-loc="all">All Locations</button>
      ${locations.map((l) => `<button class="chip ${uiState.location === l ? "active" : ""}" data-loc="${escapeHtml(l)}">${escapeHtml(l)}</button>`).join("")}
    </div>
    <div id="device-groups"></div>
  `;

  container.querySelector("#device-search").addEventListener("input", (e) => {
    uiState.search = e.target.value;
    renderGroups();
  });
  container.querySelectorAll("#status-filters .chip").forEach((btn) =>
    btn.addEventListener("click", () => {
      uiState.filter = btn.dataset.filter;
      renderDevicesPage(container);
    })
  );
  container.querySelectorAll("#location-filters .chip").forEach((btn) =>
    btn.addEventListener("click", () => {
      uiState.location = btn.dataset.loc;
      renderDevicesPage(container);
    })
  );

  function renderGroups() {
    const groupsEl = container.querySelector("#device-groups");
    const filtered = getDevices().filter((d) => {
      const matchesSearch = d.name.toLowerCase().includes(uiState.search.toLowerCase());
      const matchesLocation = uiState.location === "all" || d.location === uiState.location;
      let matchesStatus = true;
      if (uiState.filter === "on") matchesStatus = isDeviceActive(d);
      if (uiState.filter === "off") matchesStatus = !isDeviceActive(d);
      if (uiState.filter === "offline") matchesStatus = false; // demo devices are never hardware-offline individually
      return matchesSearch && matchesLocation && matchesStatus;
    });

    if (!filtered.length) {
      groupsEl.innerHTML = `<div class="empty-state">${icon("empty")}<p>No devices match your search or filters.</p></div>`;
      return;
    }

    const byLocation = {};
    filtered.forEach((d) => {
      byLocation[d.location] = byLocation[d.location] || [];
      byLocation[d.location].push(d);
    });

    groupsEl.innerHTML = Object.entries(byLocation)
      .map(
        ([loc, list]) => `
      <div class="location-group">
        <h2>${escapeHtml(loc)}</h2>
        <div class="device-grid">${list.map(deviceCardHtml).join("")}</div>
      </div>`
      )
      .join("");

    attachCardHandlers(groupsEl);
  }

  renderGroups();

  if (devicesRedraw) document.removeEventListener("devices:changed", devicesRedraw);
  devicesRedraw = () => {
    if (container.isConnected && !container.hidden) renderGroups();
  };
  document.addEventListener("devices:changed", devicesRedraw);
}

function attachCardHandlers(root) {
  root.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => toggleDevice(btn.dataset.toggle));
  });
  root.querySelectorAll("[data-fan]").forEach((wrap) => {
    wrap.querySelectorAll("[data-speed]").forEach((btn) => {
      btn.addEventListener("click", () => setFanSpeed(wrap.dataset.fan, Number(btn.dataset.speed)));
    });
  });
  root.querySelectorAll("[data-ac]").forEach((wrap) => {
    wrap.querySelectorAll("[data-dir]").forEach((btn) => {
      btn.addEventListener("click", () => adjustAcTemperature(wrap.dataset.ac, Number(btn.dataset.dir)));
    });
  });
  root.querySelectorAll("[data-curtain]").forEach((wrap) => {
    wrap.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => setCurtainAction(wrap.dataset.curtain, btn.dataset.action));
    });
  });
}

export function renderMiniDeviceRow(device) {
  const active = isDeviceActive(device);
  return `<div class="board-device-row">
    <span>${escapeHtml(device.name)}</span>
    <span class="status-chip ${active ? "" : "muted"}">${active ? "ON" : "OFF"}</span>
  </div>`;
}
