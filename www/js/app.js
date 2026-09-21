import * as storage from "./storage.js";
import { icon, toast, applyTheme, formatDate, getGreeting, timeAgo, escapeHtml } from "./ui.js";
import * as bt from "./bluetooth.js";
import * as demo from "./demo.js";
import * as energy from "./energy.js";
import * as devicesMod from "./devices.js";
import * as boardsMod from "./boards.js";
import { renderSettingsPage } from "./settings.js";
import { renderActivityPage, renderRecentActivityWidget, logActivity } from "./activity.js";

const ROUTES = ["home", "devices", "energy", "boards", "activity", "settings"];
let currentRoute = "home";
let chartRange = "today";

// ---------------- Boot ----------------
(async function boot() {
  const settings = storage.getSettings();
  applyTheme(settings.theme || "system");
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (storage.getSettings().theme === "system") applyTheme("system");
  });

  const { freshInstall } = await storage.ensureInitialized();
  await energy.initEnergy();

  buildNav();
  wireHeader();
  wireOfflineBanner();
  bt.onStatusChange(updateBluetoothChip);
  updateBluetoothChip(bt.getConnectionStatus());

  window.addEventListener("hashchange", () => navigate(location.hash.replace("#", "") || "home"));
  navigate(location.hash.replace("#", "") || "home");

  document.addEventListener("devices:changed", () => { if (currentRoute === "home") renderHome(); });
  document.addEventListener("boards:changed", () => { if (currentRoute === "home") renderHome(); });
  document.addEventListener("energy:changed", () => { if (currentRoute === "home" || currentRoute === "energy") renderCurrentRoute(); });
  document.addEventListener("activity:changed", () => { if (currentRoute === "home") renderRecentActivityWidget(document.getElementById("home-recent-activity")); });

  if (settings.demoMode !== false) {
    demo.startDemoMode();
  }

  if (freshInstall) {
    toast("Welcome — loaded with demo data. Everything here works fully offline.");
  }

  registerServiceWorker();
})();

// ---------------- Navigation ----------------
function buildNav() {
  const navItems = [
    { id: "home", label: "Home", icon: "home" },
    { id: "devices", label: "Devices", icon: "devices" },
    { id: "energy", label: "Energy", icon: "energy" },
    { id: "boards", label: "Boards", icon: "boards" },
    { id: "settings", label: "Settings", icon: "settings" },
  ];

  document.getElementById("sidebar-nav").innerHTML = navItems
    .map((n) => `<a href="#${n.id}" class="nav-item" data-nav="${n.id}">${icon(n.icon)}<span>${n.label}</span></a>`)
    .join("");

  document.getElementById("bottom-nav-list").innerHTML = navItems
    .map((n) => `<li><a href="#${n.id}" class="nav-item" data-nav="${n.id}">${icon(n.icon)}<span>${n.label}</span></a></li>`)
    .join("");
}

function navigate(route) {
  if (!ROUTES.includes(route)) route = "home";
  currentRoute = route;
  if (location.hash.replace("#", "") !== route) history.replaceState(null, "", "#" + route);

  document.querySelectorAll("[data-nav]").forEach((el) => {
    el.classList.toggle("active", el.dataset.nav === route);
  });
  document.querySelectorAll(".view").forEach((v) => {
    v.hidden = v.id !== `view-${route}`;
  });

  const titles = { home: "Overview", devices: "Devices", energy: "Energy", boards: "Boards", activity: "Activity", settings: "Settings" };
  document.getElementById("topbar-title").textContent = titles[route] || "";

  renderCurrentRoute();
}

function renderCurrentRoute() {
  if (currentRoute === "home") renderHome();
  if (currentRoute === "devices") devicesMod.renderDevicesPage(document.getElementById("view-devices"));
  if (currentRoute === "energy") renderEnergyPage();
  if (currentRoute === "boards") boardsMod.renderBoardsPage(document.getElementById("view-boards"));
  if (currentRoute === "activity") renderActivityPage(document.getElementById("view-activity"));
  if (currentRoute === "settings")
    renderSettingsPage(document.getElementById("view-settings"), {
      onDataReset: async () => {
        await energy.initEnergy();
        renderCurrentRoute();
      },
    });
}

// ---------------- Header ----------------
function wireHeader() {
  document.getElementById("greeting-text").textContent = getGreeting();
  document.getElementById("date-text").textContent = formatDate();

  document.getElementById("bell-btn").addEventListener("click", () => navigate("activity"));
  document.getElementById("gear-btn").addEventListener("click", () => navigate("settings"));
}

function updateBluetoothChip(status) {
  const chip = document.getElementById("ble-chip");
  const label = bt.BLE_STATUS_LABEL[status.status];
  chip.textContent = status.status === bt.BLE_STATUS.CONNECTED && status.deviceName ? `${label} · ${status.deviceName}` : label;
  chip.className = "status-chip " + (status.status === bt.BLE_STATUS.CONNECTED ? "" : status.status === bt.BLE_STATUS.ERROR ? "bad" : "muted");
}

function wireOfflineBanner() {
  const banner = document.getElementById("offline-banner");
  function update() {
    banner.classList.toggle("show", !navigator.onLine);
    document.getElementById("online-chip").textContent = navigator.onLine ? "Online" : "Offline Mode";
    document.getElementById("online-chip").className = "status-chip " + (navigator.onLine ? "" : "muted");
  }
  window.addEventListener("online", () => { update(); toast("Back online"); });
  window.addEventListener("offline", () => { update(); toast("You're offline — Demo Mode and local data remain available."); });
  update();
}

// ---------------- Home dashboard ----------------
function renderHome() {
  const view = document.getElementById("view-home");
  const reading = energy.getCurrentReading() || { voltage: 230, power: 0, energyConsumption: 0 };
  const todayEnergy = energy.getTodayEnergy();
  const deviceStats = devicesMod.getDeviceStats();
  const boardAgg = boardsMod.getAggregateBoardStats();

  view.innerHTML = `
    <div class="view-head">
      <div>
        <h1>Overview</h1>
        <p>Live snapshot of your energy and devices${demo.isDemoRunning() ? " · Demo Mode active" : ""}</p>
      </div>
    </div>

    <div class="grid grid-4" style="margin-bottom:20px">
      <div class="metric"><div class="label">Current Power</div><div class="value">${(reading.power / 1000).toFixed(2)}<small>kW</small></div></div>
      <div class="metric"><div class="label">Today's Energy</div><div class="value">${todayEnergy.toFixed(2)}<small>kWh</small></div></div>
      <div class="metric"><div class="label">Voltage</div><div class="value">${reading.voltage.toFixed(1)}<small>V</small></div></div>
      <div class="metric"><div class="label">Active Devices</div><div class="value">${deviceStats.active}<small>/${deviceStats.total}</small></div></div>
    </div>

    <div class="hero-card">
      <div class="hero-left">
        <div class="eyebrow">Energy Production</div>
        <div class="power-num">${(reading.power / 1000).toFixed(1)}<small>kW</small></div>
        <div class="power-sub">Powering ${deviceStats.active} of ${deviceStats.total} devices across ${boardAgg.count} boards</div>
        <div class="hero-stats">
          <div class="s"><div class="l">Today's Energy</div><div class="v">${todayEnergy.toFixed(2)} kWh</div></div>
          <div class="s"><div class="l">Voltage</div><div class="v">${reading.voltage.toFixed(1)} V</div></div>
          <div class="s"><div class="l">Current Power</div><div class="v">${reading.power.toFixed(1)} W</div></div>
        </div>
      </div>
      <div class="flow-visual">${flowVisualHtml()}</div>
    </div>

    <div class="card chart-card">
      <div class="chart-head">
        <div class="section-title" style="margin:0">Energy Usage</div>
        <div class="segmented" id="chart-range">
          ${["today", "week", "month"].map((r) => `<button class="${chartRange === r ? "active" : ""}" data-range="${r}">${r[0].toUpperCase() + r.slice(1)}</button>`).join("")}
        </div>
      </div>
      <div class="chart-wrap"><canvas id="energy-canvas" role="img" aria-label="Energy usage chart"></canvas></div>
      <div class="chart-legend">
        <span><i style="background:var(--accent-strong)"></i>Power (W)</span>
        <span><i style="background:var(--info)"></i>Energy (×100 kWh)</span>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:20px">
      <div class="card">
        <div class="section-title">Active Devices</div>
        <div id="home-active-devices"></div>
      </div>
      <div class="card">
        <div class="section-title">Recent Activity</div>
        <div id="home-recent-activity"></div>
      </div>
    </div>
  `;

  view.querySelectorAll("#chart-range button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      chartRange = btn.dataset.range;
      view.querySelectorAll("#chart-range button").forEach((b) => b.classList.toggle("active", b === btn));
      await drawHomeChart();
    });
  });

  drawHomeChart();
  renderActiveDevicesList(view.querySelector("#home-active-devices"));
  renderRecentActivityWidget(view.querySelector("#home-recent-activity"));
}

async function drawHomeChart() {
  const canvas = document.getElementById("energy-canvas");
  if (!canvas) return;
  const { labels, power, energy: energySeries } = await energy.getChartSeries(chartRange);
  const styles = getComputedStyle(document.documentElement);
  energy.renderLineChart(
    canvas,
    [
      { data: power, color: styles.getPropertyValue("--accent-strong").trim() },
      { data: energySeries.map((v) => v * 100), color: styles.getPropertyValue("--info").trim() },
    ],
    { labels }
  );
}

function renderActiveDevicesList(el) {
  const devices = devicesMod.getAllDevices().filter((d) => (d.type === "curtain" ? d.state === "OPEN" : d.type === "fan" ? d.speed > 0 : d.state));
  if (!devices.length) {
    el.innerHTML = `<div class="empty-state">${icon("empty")}<p>Nothing is on right now.</p></div>`;
    return;
  }
  el.innerHTML = devices
    .slice(0, 6)
    .map(
      (d) => `<div class="board-device-row"><span>${icon(d.icon)}&nbsp; ${escapeHtml(d.name)}</span><span class="status-chip">${d.type === "fan" ? "Speed " + d.speed : d.type === "ac" ? d.temperature + "°C" : "ON"}</span></div>`
    )
    .join("");
}

function flowVisualHtml() {
  return `
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:14px 0">
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px">
        <div class="icon-wrap" style="background:var(--accent-soft);color:var(--accent-strong)">${icon("energy")}</div>
        <span class="solar-flow-label">SOLAR</span>
      </div>
      <div class="flow-line" aria-hidden="true"></div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px">
        <div class="icon-wrap" style="background:var(--good-soft);color:var(--good)">${icon("home")}</div>
        <span class="solar-flow-label">HOME</span>
      </div>
      <div class="flow-line" aria-hidden="true"></div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px">
        <div class="icon-wrap" style="background:var(--bg-elevated);color:var(--ink-soft)">${icon("devices")}</div>
        <span class="solar-flow-label">DEVICES</span>
      </div>
    </div>`;
}

// ---------------- Energy page ----------------
async function renderEnergyPage() {
  const view = document.getElementById("view-energy");
  const reading = energy.getCurrentReading() || { voltage: 230, power: 0, energyConsumption: 0 };
  view.innerHTML = `
    <div class="view-head"><div><h1>Energy</h1><p>Voltage, power and consumption history</p></div></div>
    <div class="grid grid-3" style="margin-bottom:20px">
      <div class="metric"><div class="label">Voltage</div><div class="value">${reading.voltage.toFixed(1)}<small>V</small></div></div>
      <div class="metric"><div class="label">Current Power</div><div class="value">${reading.power.toFixed(1)}<small>W</small></div></div>
      <div class="metric"><div class="label">Session Energy</div><div class="value">${reading.energyConsumption.toFixed(3)}<small>kWh</small></div></div>
    </div>
    <div class="card chart-card">
      <div class="chart-head">
        <div class="section-title" style="margin:0">Usage History</div>
        <div class="segmented" id="chart-range-2">
          ${["today", "week", "month"].map((r) => `<button class="${chartRange === r ? "active" : ""}" data-range="${r}">${r[0].toUpperCase() + r.slice(1)}</button>`).join("")}
        </div>
      </div>
      <div class="chart-wrap"><canvas id="energy-canvas-2" role="img" aria-label="Energy history chart"></canvas></div>
      <div class="chart-legend">
        <span><i style="background:var(--accent-strong)"></i>Power (W)</span>
        <span><i style="background:var(--info)"></i>Energy (×100 kWh)</span>
      </div>
    </div>
  `;

  view.querySelectorAll("#chart-range-2 button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      chartRange = btn.dataset.range;
      view.querySelectorAll("#chart-range-2 button").forEach((b) => b.classList.toggle("active", b === btn));
      await drawEnergyPageChart();
    });
  });
  drawEnergyPageChart();
}

async function drawEnergyPageChart() {
  const canvas = document.getElementById("energy-canvas-2");
  if (!canvas) return;
  const { labels, power, energy: energySeries } = await energy.getChartSeries(chartRange);
  const styles = getComputedStyle(document.documentElement);
  energy.renderLineChart(
    canvas,
    [
      { data: power, color: styles.getPropertyValue("--accent-strong").trim() },
      { data: energySeries.map((v) => v * 100), color: styles.getPropertyValue("--info").trim() },
    ],
    { labels }
  );
}

// ---------------- Service worker ----------------
function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const register = () =>
    navigator.serviceWorker.register("service-worker.js").catch((err) => {
      console.warn("Service worker registration failed:", err.message);
    });
  // boot() is async, so the window "load" event may already have fired by now.
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
