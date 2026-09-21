// Energy monitoring: current readings, accumulation math, chart data + rendering.
import { getEnergyData, saveEnergyData, getSettings } from "./storage.js";

let currentReading = null; // { voltage, power, energyConsumption, lastUpdate }
let todayEnergyKwh = 0;
let dayAnchor = new Date().toDateString();

export function getCurrentReading() {
  return currentReading ? { ...currentReading } : null;
}

export function getTodayEnergy() {
  return todayEnergyKwh;
}

export async function initEnergy() {
  const history = await getEnergyData(1);
  const settings = getSettings();
  if (history.length) {
    currentReading = { ...history[history.length - 1] };
  } else {
    currentReading = {
      voltage: settings.energy?.baseVoltage || 230,
      power: 0,
      energyConsumption: 0,
      lastUpdate: Date.now(),
    };
  }
  // Restore today's running total if we already have it for today; otherwise start from the seed.
  try {
    const saved = JSON.parse(localStorage.getItem("se_today_energy") || "null");
    if (saved && saved.day === dayAnchor && typeof saved.kwh === "number") {
      todayEnergyKwh = saved.kwh;
    } else {
      todayEnergyKwh = settings.energy?.todayEnergyStart || 8.42;
    }
  } catch (_) {
    todayEnergyKwh = settings.energy?.todayEnergyStart || 8.42;
  }
  return currentReading;
}

// Energy(kWh) = Power(kW) x time(hours) — accumulated from elapsed real time since last update.
export function accumulateEnergy(powerWatts, now = Date.now()) {
  if (!currentReading) {
    currentReading = { voltage: 230, power: powerWatts, energyConsumption: 0, lastUpdate: now };
  }
  resetDayIfNeeded();
  // Cap the gap: if the app was closed for a long time we must not credit that whole period.
  const elapsedMs = Math.min(Math.max(0, now - currentReading.lastUpdate), 60000);
  const elapsedHours = elapsedMs / 3600000;
  const deltaKwh = (powerWatts / 1000) * elapsedHours;
  currentReading = {
    ...currentReading,
    power: powerWatts,
    energyConsumption: +(currentReading.energyConsumption + deltaKwh).toFixed(5),
    lastUpdate: now,
  };
  todayEnergyKwh = +(todayEnergyKwh + deltaKwh).toFixed(4);
  return currentReading;
}

export function setVoltage(voltage) {
  if (!currentReading) return;
  currentReading = { ...currentReading, voltage };
}

function resetDayIfNeeded() {
  const nowDay = new Date().toDateString();
  if (nowDay !== dayAnchor) {
    dayAnchor = nowDay;
    todayEnergyKwh = 0;
    try { localStorage.removeItem("se_today_energy"); } catch (_) {}
  }
}

export async function persistCurrentReading() {
  if (!currentReading) return;
  try {
    localStorage.setItem("se_today_energy", JSON.stringify({ day: dayAnchor, kwh: todayEnergyKwh }));
  } catch (_) {}
  await saveEnergyData(currentReading);
}

// ---------------- Chart data ----------------
export async function getChartSeries(range = "today") {
  const all = await getEnergyData(0);
  const now = Date.now();
  let windowMs, bucketMs, count;
  if (range === "today") {
    windowMs = 24 * 3600000;
    bucketMs = 3600000; // hourly
    count = 24;
  } else if (range === "week") {
    windowMs = 7 * 24 * 3600000;
    bucketMs = 24 * 3600000; // daily
    count = 7;
  } else {
    windowMs = 30 * 24 * 3600000;
    bucketMs = 24 * 3600000; // daily
    count = 30;
  }

  const start = now - windowMs;
  const inWindow = all.filter((r) => r.timestamp >= start);

  const buckets = new Array(count).fill(null).map((_, i) => ({
    t: start + i * bucketMs,
    power: [],
    energy: [],
  }));

  inWindow.forEach((r) => {
    const idx = Math.min(count - 1, Math.floor((r.timestamp - start) / bucketMs));
    if (buckets[idx]) {
      buckets[idx].power.push(r.power);
      buckets[idx].energy.push(r.energyConsumption);
    }
  });

  const labels = buckets.map((b) => {
    const d = new Date(b.t);
    return range === "today"
      ? d.toLocaleTimeString([], { hour: "numeric" })
      : d.toLocaleDateString([], { month: "short", day: "numeric" });
  });

  const power = buckets.map((b) => (b.power.length ? avg(b.power) : 0));
  const energy = buckets.map((b) => (b.energy.length ? Math.max(...b.energy) - Math.min(...b.energy) : 0));

  return { labels, power, energy };
}

function avg(arr) {
  return +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1);
}

// ---------------- Lightweight canvas line chart (no external chart library) ----------------
export function renderLineChart(canvas, series, options = {}) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const w = rect.width;
  const h = rect.height;
  ctx.clearRect(0, 0, w, h);

  const padding = { top: 12, right: 10, bottom: 24, left: 10 };
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;

  const allValues = series.flatMap((s) => s.data);
  const max = Math.max(1, ...allValues) * 1.15;
  const min = 0;

  const styles = getComputedStyle(document.documentElement);
  const lineColor = styles.getPropertyValue("--line").trim() || "#eee";
  const inkFaint = styles.getPropertyValue("--ink-faint").trim() || "#999";

  // Grid lines
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const y = padding.top + (chartH / 3) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(w - padding.right, y);
    ctx.stroke();
  }

  const labels = options.labels || [];
  const n = Math.max(...series.map((s) => s.data.length), labels.length);
  const stepX = n > 1 ? chartW / (n - 1) : chartW;

  series.forEach((s) => {
    if (!s.data.length) return;
    ctx.beginPath();
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    s.data.forEach((val, i) => {
      const x = padding.left + i * stepX;
      const y = padding.top + chartH - ((val - min) / (max - min)) * chartH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Soft fill under line
    const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH);
    gradient.addColorStop(0, s.color + "33");
    gradient.addColorStop(1, s.color + "00");
    ctx.lineTo(padding.left + (s.data.length - 1) * stepX, padding.top + chartH);
    ctx.lineTo(padding.left, padding.top + chartH);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
  });

  // X labels (sparse to avoid crowding)
  ctx.fillStyle = inkFaint;
  ctx.font = "11px -apple-system, sans-serif";
  ctx.textAlign = "center";
  const labelStep = Math.max(1, Math.ceil(labels.length / 6));
  labels.forEach((label, i) => {
    if (i % labelStep !== 0 && i !== labels.length - 1) return;
    const x = padding.left + i * stepX;
    ctx.fillText(label, x, h - 6);
  });
}
