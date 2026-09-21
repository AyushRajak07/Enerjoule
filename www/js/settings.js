import { getSettings, saveSettings, exportAllData, importAllData, resetAllData, getDevices, saveDevices, getBoards, saveBoards } from "./storage.js";
import { applyTheme, toast, confirmDialog, icon, escapeHtml } from "./ui.js";
import { connectBluetooth, disconnectBluetooth, isBluetoothSupported, getConnectionStatus, BLE_STATUS, BLE_STATUS_LABEL } from "./bluetooth.js";
import { isDemoRunning, startDemoMode, stopDemoMode } from "./demo.js";

export function renderSettingsPage(container, { onDataReset } = {}) {
  const settings = getSettings();
  const ble = getConnectionStatus();

  container.innerHTML = `
    <section class="settings-section">
      <h2>Appearance</h2>
      <div class="settings-row">
        <div>
          <div class="t">Theme</div>
          <div class="d">Choose how the app looks on this device</div>
        </div>
        <div class="segmented" id="theme-seg">
          ${["light", "dark", "system"].map((t) => `<button class="${settings.theme === t ? "active" : ""}" data-theme-opt="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}
        </div>
      </div>
    </section>

    <section class="settings-section">
      <h2>Bluetooth</h2>
      <div class="settings-row">
        <div>
          <div class="t">Status</div>
          <div class="d" id="ble-status-label">${BLE_STATUS_LABEL[ble.status]}</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-ghost btn-sm" id="ble-disconnect-btn" ${ble.status !== BLE_STATUS.CONNECTED ? "disabled" : ""}>Disconnect</button>
          <button class="btn btn-primary btn-sm" id="ble-connect-btn" ${!isBluetoothSupported() ? "disabled" : ""}>Scan &amp; Connect</button>
        </div>
      </div>
      <div class="card">
        <div class="field">
          <label for="ble-device-name">Device name</label>
          <input id="ble-device-name" value="${escapeHtml(settings.bluetooth?.deviceName || "")}" />
        </div>
        <div class="field">
          <label for="ble-service-uuid">Service UUID</label>
          <input id="ble-service-uuid" value="${escapeHtml(settings.bluetooth?.serviceUUID || "")}" />
        </div>
        <div class="field">
          <label for="ble-char-uuid">Characteristic UUID</label>
          <input id="ble-char-uuid" value="${escapeHtml(settings.bluetooth?.characteristicUUID || "")}" />
        </div>
        <button class="btn btn-ghost btn-block" id="save-ble-btn">Save Bluetooth Settings</button>
      </div>
      ${!isBluetoothSupported() ? `<p style="font-size:12.5px;color:var(--ink-faint);margin-top:8px">Web Bluetooth isn't available in this browser or context (it needs Chrome/Edge on desktop or Android, served over HTTPS or localhost). Demo Mode stays available regardless.</p>` : ""}
    </section>

    <section class="settings-section">
      <h2>Demo Mode</h2>
      <div class="settings-row">
        <div>
          <div class="t">Enable Demo Mode</div>
          <div class="d">Simulates voltage, power and device activity locally</div>
        </div>
        <button class="toggle" role="switch" aria-checked="${isDemoRunning()}" id="demo-toggle"></button>
      </div>
    </section>

    <section class="settings-section">
      <h2>Devices &amp; Boards (Admin)</h2>
      <div class="card" id="admin-devices"></div>
    </section>

    <section class="settings-section">
      <h2>Data</h2>
      <div class="settings-row">
        <div><div class="t">Export Data</div><div class="d">Save all local data as a JSON backup file</div></div>
        <button class="btn btn-ghost btn-sm" id="export-btn">${icon("export")}</button>
      </div>
      <div class="settings-row">
        <div><div class="t">Import Data</div><div class="d">Restore from a previously exported JSON file</div></div>
        <label class="btn btn-ghost btn-sm" for="import-file">${icon("import")}</label>
        <input type="file" id="import-file" accept="application/json" hidden />
      </div>
      <div class="settings-row">
        <div><div class="t">Reset Application</div><div class="d">Erase all local data and reload demo defaults</div></div>
        <button class="btn btn-danger btn-sm" id="reset-btn">Reset</button>
      </div>
    </section>

    <section class="settings-section">
      <h2>About</h2>
      <div class="card">
        <p style="font-size:13px;color:var(--ink-soft);line-height:1.6">
          Smart Energy is an offline-first energy and smart-home dashboard. It runs entirely in this browser — devices, boards, settings and history are stored on this device via localStorage and IndexedDB, and nothing is sent to a server. Web Bluetooth is used only as an optional link to physical hardware; every feature here also works without it, in Demo Mode.
        </p>
      </div>
    </section>
  `;

  // Theme
  container.querySelectorAll("#theme-seg button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const s = getSettings();
      s.theme = btn.dataset.themeOpt;
      saveSettings(s);
      applyTheme(s.theme);
      renderSettingsPage(container, { onDataReset });
    });
  });

  // Bluetooth
  container.querySelector("#ble-connect-btn").addEventListener("click", async () => {
    const result = await connectBluetooth();
    toast(result.ok ? "Bluetooth connected" : `Couldn't connect: ${result.reason}`);
    renderSettingsPage(container, { onDataReset });
  });
  container.querySelector("#ble-disconnect-btn").addEventListener("click", async () => {
    await disconnectBluetooth();
    toast("Bluetooth disconnected");
    renderSettingsPage(container, { onDataReset });
  });
  container.querySelector("#save-ble-btn").addEventListener("click", () => {
    const s = getSettings();
    s.bluetooth = {
      deviceName: container.querySelector("#ble-device-name").value.trim(),
      serviceUUID: container.querySelector("#ble-service-uuid").value.trim(),
      characteristicUUID: container.querySelector("#ble-char-uuid").value.trim(),
    };
    saveSettings(s);
    toast("Bluetooth settings saved");
  });

  // Demo mode
  container.querySelector("#demo-toggle").addEventListener("click", () => {
    const s = getSettings();
    if (isDemoRunning()) {
      stopDemoMode();
      s.demoMode = false;
    } else {
      startDemoMode();
      s.demoMode = true;
    }
    saveSettings(s);
    renderSettingsPage(container, { onDataReset });
  });

  renderAdminDevices(container.querySelector("#admin-devices"));

  // Data
  container.querySelector("#export-btn").addEventListener("click", async () => {
    const data = await exportAllData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `smart-energy-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Backup exported");
  });

  container.querySelector("#import-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await importAllData(data);
      toast("Data imported successfully");
      onDataReset?.();
    } catch (err) {
      toast(`Import failed: ${err.message}`);
    }
    e.target.value = "";
  });

  container.querySelector("#reset-btn").addEventListener("click", async () => {
    const confirmed = await confirmDialog({
      title: "Reset application?",
      message: "This permanently erases all devices, boards, settings, and history stored on this device, then reloads demo defaults.",
      confirmLabel: "Reset Everything",
      danger: true,
    });
    if (confirmed) {
      await resetAllData();
      toast("Application reset");
      onDataReset?.();
    }
  });
}

function renderAdminDevices(container) {
  const devices = getDevices();
  container.innerHTML = `
    <p style="font-size:12.5px;color:var(--ink-faint);margin-bottom:12px">Rename devices to match your installation. Changes save immediately and apply everywhere.</p>
    ${devices
      .map(
        (d) => `
      <div class="field" style="flex-direction:row;align-items:center;gap:10px">
        <input data-rename="${d.id}" value="${escapeHtml(d.name)}" style="flex:1" aria-label="Rename ${escapeHtml(d.name)}" />
        <span style="font-size:11.5px;color:var(--ink-faint);width:120px">${d.boardId}/${d.switchId}</span>
      </div>`
      )
      .join("")}
  `;
  container.querySelectorAll("[data-rename]").forEach((input) => {
    input.addEventListener("change", () => {
      const list = getDevices();
      const idx = list.findIndex((d) => d.id === input.dataset.rename);
      if (idx > -1) {
        list[idx].name = input.value.trim() || list[idx].name;
        saveDevices(list);
        document.dispatchEvent(new CustomEvent("devices:changed"));
        toast("Device renamed");
      }
    });
  });
}
