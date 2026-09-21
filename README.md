# Smart Energy — Home & Board Monitor

An offline-first Progressive Web App for smart-home + electrical-board energy
monitoring and control. No Firebase, no backend, no required internet
connection after the first load. Visual direction is inspired by the supplied
Heliora reference (warm neutral background, amber accent, large hero numbers)
but restyled as its own dashboard rather than a copy.

> **Note on the source AIA file:** only the two reference images were provided
> with this build (no `.aia` project file was attached). The device list, room
> groupings, board count, and `{BOARD_x/Switch_y,STATE}` command format used
> here were taken directly from your written specification, which described
> the original MIT App Inventor app's behavior. If you can share the actual
> `.aia`/`.bky`/screens later, the device map and command table in
> `js/bluetooth.js` and `data/devices.json` are the two places to reconcile
> against it.

## 1. Running it locally

Because this is served as static files, any static file server works. Do
**not** just double-click `index.html` — `fetch()` (used to load the demo
JSON) and the service worker both require an `http://` origin.

```bash
cd energyapp
python3 -m http.server 8080
# then open http://localhost:8080
```

Or with Node: `npx serve .`, or drop the folder onto Netlify/Vercel/GitHub
Pages — all work with zero configuration since there's no build step and no
server-side code.

## 2. Testing Demo Mode

Demo Mode is **on by default** and starts automatically. Every ~4 seconds it:

- Generates a new voltage/power reading around your configured baseline
  (`js/demo.js → generateEnergyReading()`).
- Accumulates energy using `Energy(kWh) = Power(kW) × elapsed hours`, based on
  real elapsed wall-clock time (`js/energy.js → accumulateEnergy()`).
- Distributes a share of that power across the six boards.
- Occasionally (~1 in 4 ticks) flips one non-curtain device to simulate real
  usage, and logs it to Activity.

Toggle it from **Settings → Demo Mode**. Turning it off freezes the dashboard
at its last known values — nothing crashes, nothing resets.

## 3. Testing Web Bluetooth

Web Bluetooth only works in Chromium-based browsers (Chrome/Edge, desktop or
Android) served from `https://` or `http://localhost` — never from a
`file://` URL and never in Firefox/Safari. Go to **Settings → Bluetooth →
Scan & Connect**; the browser's native device picker will filter for the
configured Service UUID (`0000FFE0-...` by default, editable in the same
screen). If your board isn't nearby or Bluetooth isn't supported, the button
is disabled or the pairing dialog will simply show no matches — the rest of
the app (Demo Mode, history, controls) is completely unaffected either way.

Command protocol sent over the characteristic (`js/bluetooth.js`):

```
buildSwitchCommand("BOARD_1", "Switch_1", true)  → "{BOARD_1/Switch_1,1}"
buildFanSpeedCommand("BOARD_1", "Switch_4", 2)   → "{BOARD_1/Switch_4,Speed_2}"
buildAcTemperatureCommand("BOARD_2", "Switch_1", 25) → "{BOARD_2/Switch_1,Temp_25}"
buildCurtainCommand("BOARD_2", "Switch_2", "open")   → "{BOARD_2/Switch_2,OPEN}"
```

All of these are centralized — no UI file builds a command string by hand.

## 4. What works fully offline

Once the app has loaded once (and the service worker has installed), **every
feature works with no network**:

- The dashboard, Devices, Energy, Boards, Activity and Settings pages
- All toggles, fan speed, AC temperature, curtain controls
- Demo Mode simulation
- Energy history charts (drawn on a `<canvas>`, no chart library, no CDN)
- Local data storage: devices/boards/settings in `localStorage`, energy
  history and activity logs in `IndexedDB`
- Export/Import/Reset of your local data as a JSON file
- Installing the app as a PWA ("Install app" / "Add to Home Screen")

**Only Web Bluetooth itself** needs a live radio connection to real hardware —
and even then, only the *hardware write* fails offline; the UI state, local
history and demo simulation keep working regardless.

## 5. Browser limitations to be aware of

- Web Bluetooth is unsupported in Firefox and Safari (desktop and iOS) as of
  this writing — the UI detects this and shows "Bluetooth Not Supported"
  rather than a broken button.
- Web Bluetooth requires a secure context (`https://` or `localhost`) and a
  user gesture to open the device picker — it can't auto-connect on load.
- `file://` origins cannot use Web Bluetooth, and some browsers also block
  `fetch()` of local JSON from `file://`, which is why a static server is
  recommended (see §1) — the app still has hard-coded in-memory fallback data
  in `js/storage.js` so it won't crash even if the JSON fetch fails.

## 6. Project structure

```
energyapp/
├── index.html
├── manifest.json
├── service-worker.js
├── css/            reset, variables (design tokens), layout, components,
│                   dashboard, devices, boards, responsive
├── js/
│   ├── app.js          routing, header, dashboard + energy page rendering
│   ├── storage.js      localStorage + IndexedDB abstraction layer
│   ├── idb.js           small IndexedDB helper used only by storage.js
│   ├── bluetooth.js     Web Bluetooth layer + centralized command builder
│   ├── demo.js          offline simulation engine
│   ├── energy.js        energy math, chart data, canvas chart renderer
│   ├── devices.js       device state, controls, rendering
│   ├── boards.js        board aggregation + rendering
│   ├── settings.js      appearance/BLE/data/admin settings page
│   ├── activity.js      activity log read/write/render
│   └── ui.js            icons, toasts, modal, theming, formatting helpers
├── data/            devices.json, boards.json, default-settings.json
└── assets/icons/    icon.svg (used for favicon + manifest icons)
```

## 7. Notes on icons

`assets/icons/icon.svg` is used for both manifest icon slots via
`"sizes": "any"`, which modern Chromium/Android accept without needing
pre-rendered PNGs. If a stricter installability audit requires literal
192×192/512×512 PNGs, rasterize that SVG and add the extra entries to
`manifest.json`.


// git cmd to use
git add .
git commit -m "Comment line"
git push 