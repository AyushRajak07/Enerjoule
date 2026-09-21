# HANDOFF: Smart Energy Android app (continue from here)

## What this project is
Offline-first PWA (Smart Energy: Home & Board Monitor) wrapped as an Android app with Capacitor 8.
Web code lives in `www/`. Native Android project in `android/`. Package id: `com.smartenergy.app`.
Talks to ESP/BLE boards using commands like `{BOARD_1/Switch_1,1}` (see `www/js/bluetooth.js`).

## Environment limits found (why no APK was built in the previous chat)
The sandbox blocks dl.google.com, maven.google.com, repo.maven.apache.org, plugins.gradle.org.
So the Android SDK / Gradle cannot be downloaded there. npm registry IS reachable.
=> The APK must be built on GitHub Actions (workflow included) or locally with Android Studio.
JDK 21 and Node 22 exist in the sandbox. A Chrome binary for tests:
/home/claude/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome (use Playwright with executable_path, args --no-sandbox).
Note: background servers die between bash calls; start the http server and the test in the SAME command.

## How to get the APK (user steps)
1. Create a GitHub repo, push all these files (including `android/` and `.github/`).
2. `git add . && git commit -m "Android app" && git push` (branch main).
3. GitHub -> Actions -> "Build Android APK" -> download `SmartEnergy.apk` artifact
   (also published under Releases, tag `latest`).
4. Install on phone (allow unknown sources).
Local alternative: install Android Studio, `npm install`, `npx cap sync android`, `npx cap open android`, Build > Build APK.

## Done so far
- Reorganised flat uploads into: www/{index.html,manifest.json,service-worker.js,css/,js/,data/,assets/icons/}.
- New `www/js/bluetooth.js`: dual backend (Capacitor native BluetoothLe plugin inside the app, Web Bluetooth in browsers),
  same exported API (connectBluetooth, disconnectBluetooth (now async), sendCommand, build*Command, onStatusChange, ...).
  Scan does NOT filter by service UUID (many FFE0 modules don't advertise it); filters by saved device-name prefix if set.
  Writes are serialized, chunked to 20 bytes, listeners cleaned on reconnect. Plugin proxy obtained via Capacitor.registerPlugin("BluetoothLe") (no bundler).
- `www/index.html` loads `capacitor.js` (injected by native container; 404 in a plain browser is expected and harmless), inline theme bootstrap to stop dark flash.
- Fixed: listener leaks in boards.js/devices.js; XSS (escapeHtml added to ui.js and used in boards/devices/activity/settings/app);
  NaN Today's Energy (energy.js history rows use `timestamp`, live uses `lastUpdate`); elapsed-energy gap capped to 60s;
  Today's Energy persisted in localStorage `se_today_energy`; navigate() hash loop; service worker registration race
  (boot is async so window "load" had already fired) -> now registers when readyState complete; SW cache v2, skips capacitor.js and cross-origin;
  topbar CSS classes; flow-line animation-delay selector; topbar safe-area padding.
- Icons: PNG icons (192/512 + maskable) and all Android launcher/splash icons generated with PIL (scripts were mkicons.py / mkandroidicons.py).
- Android: Bluetooth permissions in AndroidManifest (BLUETOOTH_SCAN neverForLocation, BLUETOOTH_CONNECT, legacy perms maxSdk 30), release signing
  in app/build.gradle (uses release.keystore if present else debug key), launcher background #F5A623.
- `.github/workflows/build-apk.yml`: builds release APK (Node 22, JDK 21, android-actions/setup-android), generates temp keystore unless
  secrets KEYSTORE_BASE64 / KEYSTORE_PASSWORD / KEY_ALIAS / KEY_PASSWORD are set, uploads artifact, publishes Release `latest`.
- Headless Chrome E2E passed: nav, toggles, fan speed, AC temp, search, XSS blocked, boards redraw once, dark theme persists,
  service worker active, offline reload works, mobile bottom nav OK, no horizontal overflow, no JS errors.

## NOT done / to verify next
1. The Gradle build was never run (SDK unreachable). First cloud build may need fixes: send the Actions log to Claude.
2. Bluetooth untested on real hardware. If "service not found": check Service/Characteristic UUID in Settings
   (defaults 0000FFE0.. / 0000FFE1..). Confirm the board really uses this UUID pair and the command format.
3. Hero card flow diagram (Solar -> Home -> Devices) looks right on desktop; not yet checked on mobile.
   Screenshots of Devices/Boards/Settings/Activity/mobile were captured to /tmp but not reviewed (may be gone; retake with shots script).
4. Consider: stable release keystore (add KEYSTORE_BASE64 secret) so updates install over old versions;
   change appId before Play Store; the "Demo Mode" simulation should be off when real BLE data is used (no incoming-data parser is wired yet:
   `setIncomingDataHandler` exists but nothing turns board telemetry into readings; needs the board's telemetry format).
5. Optional earlier ideas: alert/notification dot on bell, real per-board data from BLE, export/import already exists.

## File map
www/js: app (routing/home/energy page), storage (localStorage + IndexedDB), idb, bluetooth, demo (simulation), energy (math+canvas chart),
devices, boards, settings, activity, ui (icons/toast/modal/escapeHtml). www/data: devices.json, boards.json, default-settings.json.
