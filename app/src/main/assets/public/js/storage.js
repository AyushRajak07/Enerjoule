// Storage abstraction layer.
// localStorage -> devices, boards, settings, UI state (small, frequently read config)
// IndexedDB    -> energy history, activity logs (larger, append-heavy datasets)
// Swap this module out later to point at a different backend without touching the UI.

import { idbGetAll, idbAdd, idbClear, idbBulkPut, idbTrim } from "./idb.js";

const LS_KEYS = {
  devices: "se_devices",
  boards: "se_boards",
  settings: "se_settings",
  initFlag: "se_initialized",
};

const MAX_ENERGY_HISTORY = 2000;
const MAX_LOGS = 500;

function readLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`Storage read failed for ${key}:`, err.message);
    return fallback;
  }
}

function writeLS(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn(`Storage write failed for ${key}:`, err.message);
    return false;
  }
}

async function fetchJson(path, fallback) {
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error("bad response");
    return await res.json();
  } catch (err) {
    console.warn(`Could not fetch ${path}, using built-in default. (${err.message})`);
    return fallback;
  }
}

// ---- Built-in fallbacks (used if data/*.json cannot be fetched, e.g. file:// origin) ----
const FALLBACK_SETTINGS = {
  theme: "system",
  demoMode: true,
  bluetooth: {
    deviceName: "SmartBoard-BLE",
    serviceUUID: "0000FFE0-0000-1000-8000-00805F9B34FB",
    characteristicUUID: "0000FFE1-0000-1000-8000-00805F9B34FB",
  },
  energy: { baseVoltage: 230, voltageJitter: 6, todayEnergyStart: 8.42 },
};

// ---------------- Devices ----------------
export function getDevices() {
  return readLS(LS_KEYS.devices, []);
}
export function saveDevices(devices) {
  return writeLS(LS_KEYS.devices, devices);
}

// ---------------- Boards ----------------
export function getBoards() {
  return readLS(LS_KEYS.boards, []);
}
export function saveBoards(boards) {
  return writeLS(LS_KEYS.boards, boards);
}

// ---------------- Settings ----------------
export function getSettings() {
  return readLS(LS_KEYS.settings, FALLBACK_SETTINGS);
}
export function saveSettings(settings) {
  return writeLS(LS_KEYS.settings, settings);
}

// ---------------- Energy history (IndexedDB) ----------------
export async function getEnergyData(limit = MAX_ENERGY_HISTORY) {
  const all = await idbGetAll("energyHistory");
  const sorted = all.sort((a, b) => a.timestamp - b.timestamp);
  return limit ? sorted.slice(-limit) : sorted;
}

export async function saveEnergyData(reading) {
  // reading: { voltage, power, energyConsumption, lastUpdate }
  const record = {
    voltage: reading.voltage,
    power: reading.power,
    energyConsumption: reading.energyConsumption,
    timestamp: reading.lastUpdate || Date.now(),
  };
  await idbAdd("energyHistory", record);
  await idbTrim("energyHistory", MAX_ENERGY_HISTORY);
  return record;
}

export async function clearEnergyData() {
  return idbClear("energyHistory");
}

// ---------------- Activity logs (IndexedDB) ----------------
export async function getLogs(limit = 100) {
  const all = await idbGetAll("activityLogs");
  const sorted = all.sort((a, b) => b.timestamp - a.timestamp);
  return limit ? sorted.slice(0, limit) : sorted;
}

export async function saveLogs(entry) {
  // entry: { message, type, timestamp }
  const record = {
    message: entry.message,
    type: entry.type || "info",
    timestamp: entry.timestamp || Date.now(),
  };
  await idbAdd("activityLogs", record);
  await idbTrim("activityLogs", MAX_LOGS);
  return record;
}

export async function clearLogs() {
  return idbClear("activityLogs");
}

// ---------------- First-run initialization ----------------
export async function ensureInitialized() {
  const alreadyInit = readLS(LS_KEYS.initFlag, false);
  if (alreadyInit && getDevices().length && getBoards().length) {
    return { freshInstall: false };
  }

  const [devices, boards, settings] = await Promise.all([
    fetchJson("data/devices.json", []),
    fetchJson("data/boards.json", []),
    fetchJson("data/default-settings.json", FALLBACK_SETTINGS),
  ]);

  const now = Date.now();
  const boardsWithTime = boards.map((b) => ({ ...b, lastUpdate: now }));
  const devicesWithTime = devices.map((d) => ({ ...d, lastUpdated: now }));

  saveDevices(devicesWithTime);
  saveBoards(boardsWithTime);
  saveSettings(settings);
  writeLS(LS_KEYS.initFlag, true);

  // Seed some historical energy points so the chart isn't empty on first run.
  const existingHistory = await getEnergyData(1);
  if (existingHistory.length === 0) {
    const seed = [];
    const base = settings.energy?.baseVoltage || 230;
    for (let i = 47; i >= 0; i--) {
      const t = now - i * 30 * 60 * 1000; // every 30 min for last ~24h
      const voltage = +(base + (Math.random() * 6 - 3)).toFixed(1);
      const power = +(80 + Math.random() * 200).toFixed(1);
      seed.push({ voltage, power, energyConsumption: +((power / 1000) * 0.5).toFixed(4), timestamp: t });
    }
    await idbBulkPut("energyHistory", seed);
  }

  await saveLogs({ message: "Application initialized with demo data", type: "system", timestamp: now });

  return { freshInstall: true };
}

// ---------------- Export / Import / Reset ----------------
export async function exportAllData() {
  const [energyHistory, logs] = await Promise.all([getEnergyData(0), getLogs(0)]);
  return {
    exportedAt: new Date().toISOString(),
    version: 1,
    devices: getDevices(),
    boards: getBoards(),
    settings: getSettings(),
    energyHistory,
    logs,
  };
}

export async function importAllData(data) {
  if (!data || typeof data !== "object") throw new Error("Invalid backup file");
  if (!Array.isArray(data.devices) || !Array.isArray(data.boards)) {
    throw new Error("Backup file is missing required device/board data");
  }
  saveDevices(data.devices);
  saveBoards(data.boards);
  if (data.settings) saveSettings(data.settings);
  if (Array.isArray(data.energyHistory)) {
    await clearEnergyData();
    await idbBulkPut(
      "energyHistory",
      data.energyHistory.map(({ id, ...rest }) => rest)
    );
  }
  if (Array.isArray(data.logs)) {
    await clearLogs();
    await idbBulkPut(
      "activityLogs",
      data.logs.map(({ id, ...rest }) => rest)
    );
  }
  writeLS(LS_KEYS.initFlag, true);
  return true;
}

export async function resetAllData() {
  localStorage.removeItem(LS_KEYS.devices);
  localStorage.removeItem(LS_KEYS.boards);
  localStorage.removeItem(LS_KEYS.settings);
  localStorage.removeItem(LS_KEYS.initFlag);
  await clearEnergyData();
  await clearLogs();
  return ensureInitialized();
}
