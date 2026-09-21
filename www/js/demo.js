// Demo Mode: simulates realistic voltage/power/energy/device behaviour locally.
// This never talks to hardware — it exists precisely so the dashboard has
// something meaningful to show when Bluetooth/hardware isn't connected.
import { getSettings, getDevices, saveDevices } from "./storage.js";
import { accumulateEnergy, setVoltage, persistCurrentReading, getCurrentReading } from "./energy.js";
import { getTotalDevicePower } from "./devices.js";
import { updateBoardReadings, getBoardsWithStats } from "./boards.js";
import { logActivity } from "./activity.js";

let tickTimer = null;
let persistTimer = null;
const TICK_MS = 4000;
const PERSIST_MS = 30000;

export function calculateTotalPower() {
  return getTotalDevicePower();
}

export function generateEnergyReading() {
  const settings = getSettings();
  const base = settings.energy?.baseVoltage || 230;
  const jitter = settings.energy?.voltageJitter || 6;
  const voltage = +(base + (Math.random() * jitter - jitter / 2)).toFixed(1);
  const power = calculateTotalPower() + +(Math.random() * 15).toFixed(1); // small standby draw
  return { voltage, power };
}

// Occasionally nudge a device's state to simulate real-world usage patterns.
export async function simulateDeviceChanges() {
  const devices = getDevices();
  if (!devices.length) return;
  if (Math.random() > 0.22) return; // most ticks: no change, keeps the UI calm

  const candidate = devices[Math.floor(Math.random() * devices.length)];
  if (candidate.type === "curtain") return; // don't auto-move curtains, too surprising

  let changed = false;
  const updated = devices.map((d) => {
    if (d.id !== candidate.id) return d;
    changed = true;
    if (d.type === "fan") {
      const nextSpeed = d.speed > 0 ? 0 : Math.ceil(Math.random() * 3);
      return { ...d, state: nextSpeed > 0, speed: nextSpeed, lastUpdated: Date.now() };
    }
    return { ...d, state: !d.state, lastUpdated: Date.now() };
  });

  if (changed) {
    saveDevices(updated);
    document.dispatchEvent(new CustomEvent("devices:changed"));
    const label = candidate.type === "fan" ? "speed changed (auto)" : `${!candidate.state ? "turned ON" : "turned OFF"} (auto)`;
    await logActivity(`${candidate.name} ${label}`);
  }
}

function tick() {
  const reading = generateEnergyReading();
  setVoltage(reading.voltage);
  accumulateEnergy(reading.power);
  document.dispatchEvent(new CustomEvent("energy:changed", { detail: getCurrentReading() }));

  // Distribute readings across boards proportionally so board pages feel alive too.
  const boards = getBoardsWithStats().filter((b) => b.online);
  const readings = {};
  boards.forEach((b) => {
    const jitter = (Math.random() * 4 - 2);
    readings[b.id] = {
      voltage: +(reading.voltage + jitter).toFixed(1),
      power: b.power,
      energyDelta: +((b.power / 1000) * (TICK_MS / 3600000)).toFixed(6),
    };
  });
  updateBoardReadings(readings);

  simulateDeviceChanges();
}

export function startDemoMode() {
  if (tickTimer) return;
  tick();
  tickTimer = setInterval(tick, TICK_MS);
  persistTimer = setInterval(() => persistCurrentReading(), PERSIST_MS);
  document.dispatchEvent(new CustomEvent("demo:status", { detail: { running: true } }));
}

export function stopDemoMode() {
  clearInterval(tickTimer);
  clearInterval(persistTimer);
  tickTimer = null;
  persistTimer = null;
  document.dispatchEvent(new CustomEvent("demo:status", { detail: { running: false } }));
}

export function isDemoRunning() {
  return !!tickTimer;
}
