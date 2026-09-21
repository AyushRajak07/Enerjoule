// js/bluetooth.js
// Dual-backend Bluetooth layer.
//   • Inside the Android app  -> native BLE via the Capacitor "BluetoothLe" plugin
//   • In a Chromium browser   -> Web Bluetooth (navigator.bluetooth)
// The exported API is identical for both, so no other module needs to know
// which backend is in use.

import { getSettings } from "./storage.js";

/* =========================================================
   BLE STATUS
========================================================= */

export const BLE_STATUS = {
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  ERROR: "error",
  UNSUPPORTED: "unsupported",
};

export const BLE_STATUS_LABEL = {
  [BLE_STATUS.DISCONNECTED]: "Bluetooth Disconnected",
  [BLE_STATUS.CONNECTING]: "Connecting…",
  [BLE_STATUS.CONNECTED]: "Bluetooth Connected",
  [BLE_STATUS.ERROR]: "Connection Error",
  [BLE_STATUS.UNSUPPORTED]: "Bluetooth Not Supported",
};

/* =========================================================
   BACKEND DETECTION
========================================================= */

let nativePluginCache = null;

function getNativePlugin() {
  if (nativePluginCache) return nativePluginCache;
  const cap = typeof window !== "undefined" ? window.Capacitor : null;
  if (!cap) return null;
  const isNative =
    typeof cap.isNativePlatform === "function"
      ? cap.isNativePlatform()
      : cap.getPlatform && cap.getPlatform() !== "web";
  if (!isNative) return null;

  // No bundler here, so build the plugin proxy ourselves. Native code has
  // already injected the plugin's method list into Capacitor.PluginHeaders.
  try {
    nativePluginCache =
      cap.Plugins?.BluetoothLe ||
      (typeof cap.registerPlugin === "function" ? cap.registerPlugin("BluetoothLe") : null);
  } catch (err) {
    console.warn("[BLE] Could not register native plugin:", err.message);
    nativePluginCache = null;
  }
  return nativePluginCache;
}

function isNativeBackend() {
  return !!getNativePlugin();
}

export function isBluetoothSupported() {
  if (isNativeBackend()) return true;
  return (
    typeof navigator !== "undefined" &&
    "bluetooth" in navigator &&
    !!navigator.bluetooth
  );
}

/* =========================================================
   STATE
========================================================= */

const state = {
  status: isBluetoothSupported() ? BLE_STATUS.DISCONNECTED : BLE_STATUS.UNSUPPORTED,
  lastError: null,
  deviceName: null,
  // web backend
  device: null,
  server: null,
  service: null,
  characteristic: null,
  // native backend
  nativeDeviceId: null,
  nativeProps: null,
  nativeListeners: [],
  writeMode: null, // "response" | "noresponse" | "legacy"
};

const listeners = new Set();

function publicState() {
  return {
    status: state.status,
    lastError: state.lastError,
    deviceName: state.deviceName,
    backend: isNativeBackend() ? "native" : "web",
  };
}

function setStatus(status, error = null) {
  state.status = status;
  state.lastError = error;
  console.log(`[BLE] Status: ${status}`, error ? `| Error: ${error}` : "");
  listeners.forEach((fn) => {
    try {
      fn(publicState());
    } catch (err) {
      console.warn("[BLE] Status listener error:", err);
    }
  });
}

export function onStatusChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getConnectionStatus() {
  return publicState();
}

/* =========================================================
   HELPERS
========================================================= */

function normalizeUUID(uuid, fallback = "") {
  return String(uuid || fallback).trim().toLowerCase();
}

function getBluetoothConfig() {
  const settings = getSettings() || {};
  return {
    deviceName: (settings.bluetooth?.deviceName || "").trim(),
    serviceUUID: normalizeUUID(settings.bluetooth?.serviceUUID, "0000ffe0-0000-1000-8000-00805f9b34fb"),
    characteristicUUID: normalizeUUID(settings.bluetooth?.characteristicUUID, "0000ffe1-0000-1000-8000-00805f9b34fb"),
  };
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex) {
  const clean = String(hex || "").replace(/[^0-9a-fA-F]/g, "");
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

function chunk(data, size = 20) {
  const parts = [];
  for (let i = 0; i < data.length; i += size) parts.push(data.slice(i, i + size));
  return parts;
}

function describeError(err) {
  const msg = err?.message || String(err);
  if (/user (cancel|denied)|NotFoundError|cancelled|canceled|dismissed/i.test(msg)) {
    return "No device was selected.";
  }
  if (/permission/i.test(msg)) {
    return "Bluetooth permission was denied. Allow 'Nearby devices' for this app in Android settings.";
  }
  if (/not enabled|powered off|disabled/i.test(msg)) {
    return "Bluetooth is turned off. Turn it on and try again.";
  }
  return msg;
}

/* =========================================================
   INCOMING DATA
========================================================= */

let incomingDataHandler = null;

export function setIncomingDataHandler(fn) {
  incomingDataHandler = fn;
}

function emitIncoming(bytes) {
  try {
    const text = new TextDecoder().decode(bytes);
    console.log("[BLE RX]", text);
    if (incomingDataHandler) incomingDataHandler(text);
  } catch (err) {
    console.warn("[BLE] Failed to decode incoming data:", err.message);
  }
}

// Kept for backwards compatibility with the previous API.
export function handleIncomingData(dataView) {
  const bytes =
    dataView instanceof Uint8Array
      ? dataView
      : new Uint8Array(dataView.buffer, dataView.byteOffset || 0, dataView.byteLength);
  emitIncoming(bytes);
}

/* =========================================================
   CONNECT
========================================================= */

export async function connectBluetooth() {
  if (!isBluetoothSupported()) {
    const reason = "Bluetooth is not supported here. Use the Android app or Chrome/Edge over HTTPS.";
    setStatus(BLE_STATUS.UNSUPPORTED, reason);
    return { ok: false, reason };
  }
  if (state.status === BLE_STATUS.CONNECTING) {
    return { ok: false, reason: "Already connecting…" };
  }

  // Clean up any previous session so listeners don't pile up on reconnect.
  await teardown();

  setStatus(BLE_STATUS.CONNECTING);
  try {
    return isNativeBackend() ? await connectNative() : await connectWeb();
  } catch (err) {
    console.error("[BLE] Connection failed:", err);
    await teardown();
    const reason = describeError(err);
    setStatus(BLE_STATUS.ERROR, reason);
    return { ok: false, reason };
  }
}

/* ---------------- Native (Capacitor) ---------------- */

async function connectNative() {
  const plugin = getNativePlugin();
  const { deviceName, serviceUUID, characteristicUUID } = getBluetoothConfig();

  await plugin.initialize({ androidNeverForLocation: true });

  const enabled = await plugin.isEnabled().catch(() => ({ value: true }));
  if (enabled && enabled.value === false) {
    try {
      await plugin.requestEnable();
    } catch (_) {
      throw new Error("Bluetooth is turned off. Turn it on and try again.");
    }
  }

  // Many HM-10 / FFE0-style modules don't advertise their service UUID,
  // so we don't filter by service. Filter by saved name if provided,
  // otherwise let the user pick from every nearby device.
  const scanOptions = { optionalServices: [serviceUUID] };
  if (deviceName) scanOptions.namePrefix = deviceName;

  const device = await plugin.requestDevice(scanOptions);
  if (!device?.deviceId) throw new Error("No Bluetooth device selected.");

  const deviceId = device.deviceId;
  state.nativeDeviceId = deviceId;
  state.deviceName = device.name || "(unnamed)";

  const disconnectHandle = await plugin.addListener(`disconnected|${deviceId}`, () => handleDisconnected());
  state.nativeListeners.push(disconnectHandle);

  await plugin.connect({ deviceId, timeout: 15000 });

  // Verify the expected service/characteristic exist and learn write capabilities.
  const svc = await plugin.getServices({ deviceId });
  const services = svc?.services || [];
  const service = services.find((s) => normalizeUUID(s.uuid) === serviceUUID);
  if (!service) {
    throw new Error(`BLE service not found: ${serviceUUID}. Check the Service UUID in Settings.`);
  }
  const ch = (service.characteristics || []).find((c) => normalizeUUID(c.uuid) === characteristicUUID);
  if (!ch) {
    throw new Error(`BLE characteristic not found: ${characteristicUUID}. Check the Characteristic UUID in Settings.`);
  }

  const props = ch.properties || {};
  state.writeMode = props.write ? "response" : props.writeWithoutResponse ? "noresponse" : null;
  state.nativeProps = props;
  console.log("[BLE] Characteristic properties:", props);

  if (props.notify || props.indicate) {
    const key = `notification|${deviceId}|${serviceUUID}|${characteristicUUID}`;
    const notifHandle = await plugin.addListener(key, (event) => {
      const v = event?.value;
      if (typeof v === "string") emitIncoming(hexToBytes(v));
      else if (v && v.buffer) handleIncomingData(v);
    });
    state.nativeListeners.push(notifHandle);
    await plugin.startNotifications({ deviceId, service: serviceUUID, characteristic: characteristicUUID });
  }

  setStatus(BLE_STATUS.CONNECTED);
  return { ok: true, deviceName: state.deviceName };
}

/* ---------------- Web Bluetooth ---------------- */

async function connectWeb() {
  const { deviceName, serviceUUID, characteristicUUID } = getBluetoothConfig();

  // Filter by name if configured; otherwise accept all devices and request the
  // service as optional (works for modules that don't advertise it).
  const options = deviceName
    ? { filters: [{ namePrefix: deviceName }], optionalServices: [serviceUUID] }
    : { acceptAllDevices: true, optionalServices: [serviceUUID] };

  const device = await navigator.bluetooth.requestDevice(options);
  if (!device) throw new Error("No Bluetooth device selected.");
  if (!device.gatt) throw new Error("Selected device does not provide a GATT server.");

  state.device = device;
  state.deviceName = device.name || "(unnamed)";
  device.addEventListener("gattserverdisconnected", handleDisconnected);

  const server = await device.gatt.connect();
  state.server = server;

  let service;
  try {
    service = await server.getPrimaryService(serviceUUID);
  } catch (_) {
    throw new Error(`BLE service not found: ${serviceUUID}. Check the Service UUID in Settings.`);
  }
  state.service = service;

  let characteristic;
  try {
    characteristic = await service.getCharacteristic(characteristicUUID);
  } catch (_) {
    throw new Error(`BLE characteristic not found: ${characteristicUUID}. Check the Characteristic UUID in Settings.`);
  }
  state.characteristic = characteristic;

  const props = characteristic.properties || {};
  state.writeMode = props.write ? "response" : props.writeWithoutResponse ? "noresponse" : "legacy";

  if (props.notify || props.indicate) {
    characteristic.addEventListener("characteristicvaluechanged", onWebNotification);
    await characteristic.startNotifications();
  }

  setStatus(BLE_STATUS.CONNECTED);
  return { ok: true, deviceName: state.deviceName };
}

function onWebNotification(event) {
  handleIncomingData(event.target.value);
}

/* =========================================================
   DISCONNECT
========================================================= */

function handleDisconnected() {
  if (state.status === BLE_STATUS.DISCONNECTED) return;
  console.warn("[BLE] Device disconnected");
  cleanupState();
  setStatus(BLE_STATUS.DISCONNECTED);
}

function cleanupState() {
  state.device = null;
  state.server = null;
  state.service = null;
  state.characteristic = null;
  state.nativeDeviceId = null;
  state.nativeProps = null;
  state.writeMode = null;
  state.deviceName = null;
  state.nativeListeners.forEach((h) => {
    try {
      h?.remove?.();
    } catch (_) {}
  });
  state.nativeListeners = [];
}

// Fully release the current connection (both backends) without changing status.
async function teardown() {
  try {
    if (state.characteristic) {
      state.characteristic.removeEventListener("characteristicvaluechanged", onWebNotification);
    }
    if (state.device) {
      state.device.removeEventListener("gattserverdisconnected", handleDisconnected);
      if (state.device.gatt?.connected) state.device.gatt.disconnect();
    }
    const plugin = getNativePlugin();
    if (plugin && state.nativeDeviceId) {
      await plugin.disconnect({ deviceId: state.nativeDeviceId }).catch(() => {});
    }
  } catch (err) {
    console.warn("[BLE] Teardown warning:", err.message);
  }
  cleanupState();
}

export async function disconnectBluetooth() {
  console.log("[BLE] Disconnecting…");
  await teardown();
  setStatus(isBluetoothSupported() ? BLE_STATUS.DISCONNECTED : BLE_STATUS.UNSUPPORTED);
}

/* Kept for backwards compatibility. Notifications are started during connect. */
export async function startNotifications() {
  return state.status === BLE_STATUS.CONNECTED;
}

/* =========================================================
   SEND COMMAND
========================================================= */

let sendQueue = Promise.resolve();

export function sendCommand(commandString) {
  // Serialise writes: BLE only allows one GATT operation at a time.
  const run = () => doSend(commandString);
  const result = sendQueue.then(run, run);
  sendQueue = result.catch(() => {});
  return result;
}

async function doSend(commandString) {
  if (state.status !== BLE_STATUS.CONNECTED) {
    return { ok: false, reason: "not-connected" };
  }

  const bytes = new TextEncoder().encode(commandString);
  const parts = chunk(bytes, 20);
  console.log("[BLE TX]", commandString);

  try {
    if (isNativeBackend()) {
      const plugin = getNativePlugin();
      const { serviceUUID, characteristicUUID } = getBluetoothConfig();
      const deviceId = state.nativeDeviceId;
      if (!deviceId) return { ok: false, reason: "not-connected" };

      for (const part of parts) {
        const args = { deviceId, service: serviceUUID, characteristic: characteristicUUID, value: bytesToHex(part) };
        if (state.writeMode === "noresponse") {
          await plugin.writeWithoutResponse(args);
        } else {
          try {
            await plugin.write(args);
          } catch (err) {
            if (!state.nativeProps?.writeWithoutResponse) throw err;
            await plugin.writeWithoutResponse(args);
          }
        }
      }
    } else {
      const ch = state.characteristic;
      if (!ch || !state.device?.gatt?.connected) {
        handleDisconnected();
        return { ok: false, reason: "not-connected" };
      }
      for (const part of parts) {
        if (state.writeMode === "noresponse" && ch.writeValueWithoutResponse) {
          await ch.writeValueWithoutResponse(part);
        } else if (ch.writeValueWithResponse) {
          try {
            await ch.writeValueWithResponse(part);
          } catch (err) {
            if (!ch.writeValueWithoutResponse) throw err;
            await ch.writeValueWithoutResponse(part);
          }
        } else {
          await ch.writeValue(part);
        }
      }
    }
    return { ok: true };
  } catch (err) {
    console.error("[BLE TX] Send failed:", err);
    const reason = describeError(err);
    setStatus(BLE_STATUS.ERROR, reason);
    return { ok: false, reason };
  }
}

/* =========================================================
   COMMAND CONFIG + BUILDERS
========================================================= */

export const COMMAND_CONFIG = {
  switch: { on: "1", off: "0" },
  fan: { speedPrefix: "Speed" },
  ac: { tempPrefix: "Temp" },
  curtain: { open: "OPEN", close: "CLOSE", stop: "STOP" },
};

export function buildSwitchCommand(boardId, switchId, on) {
  const value = on ? COMMAND_CONFIG.switch.on : COMMAND_CONFIG.switch.off;
  return `{${boardId}/${switchId},${value}}`;
}

export function buildFanSpeedCommand(boardId, switchId, speed) {
  return `{${boardId}/${switchId},${COMMAND_CONFIG.fan.speedPrefix}_${speed}}`;
}

export function buildAcTemperatureCommand(boardId, switchId, temperature) {
  return `{${boardId}/${switchId},${COMMAND_CONFIG.ac.tempPrefix}_${temperature}}`;
}

export function buildCurtainCommand(boardId, switchId, action) {
  const value = COMMAND_CONFIG.curtain[action] || COMMAND_CONFIG.curtain.stop;
  return `{${boardId}/${switchId},${value}}`;
}
