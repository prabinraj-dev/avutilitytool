# AV Control Utility (MVP)

A desktop AV device monitoring and control app built with Electron. It covers
the three modules from the spec:

1. **Devices** — add hardware manually, or sweep a CIDR range for open ports.
   Live status (online / unresponsive / offline) via a configurable heartbeat.
2. **Command Console** — pick a device, type an ASCII/UTF-8/hex payload, pick
   a delimiter (CR / LF / CRLF / custom), and watch transmitted + received
   bytes in a live log.
3. **Control** — a day-to-day dashboard (volume up/down/mute/slider, source
   buttons) whose buttons are wired to raw commands through a per-device
   command mapping matrix (Settings → Edit command mapping).

4. **Device Test** — Teams-style pre-meeting check for USB (or built-in)
   peripherals. Pick a camera, microphone and speaker from dropdowns; see a
   live camera preview, a mic level meter, a 5-second record-and-playback, and
   a test chime (with left/right checks) played through the chosen speaker.
   Plugging a device in or out shows a notification and, by default, switches
   to the new device automatically.

## Running it

Requires [Node.js](https://nodejs.org) (18+) and npm.

```bash
npm install
npm start        # run in development
npm run dist     # build the Windows installer into dist/
```

Data (devices, mappings, heartbeat settings) is saved as JSON under Electron's
per-OS user-data directory, so it survives restarts without any extra setup.

## Project layout

```
main.js              Electron entry point — window + wiring
preload.js            contextBridge API surface exposed to the renderer
src/store.js          JSON persistence for devices / mappings / settings
src/ipc.js             ipcMain handlers tying the renderer to the net layer
src/net/tcp.js          TCP send + connect probes (used by console/heartbeat/scan)
src/net/udp.js          UDP send + best-effort reachability probe
src/net/discovery.js    CIDR parsing + concurrent port-probe subnet sweep
src/net/heartbeat.js    Periodic online/unresponsive/offline polling
src/net/encode.js       Payload + delimiter → Buffer, and Buffer → hex/ASCII views
renderer/               UI: index.html, styles.css, app.js, devices.js, console.js, control.js, devicetest.js
```

## Design notes / MVP limitations to know about

- **Discovery** uses a TCP connect probe per host/port rather than a true
  ICMP ping sweep, since raw ICMP sockets need elevated privileges on most
  OSes. This is reliable and cross-platform, but only finds hosts that have
  the probed port(s) open.
- **Heartbeat** can run over TCP (connect probe, distinguishes timeout
  "unresponsive" from refused "offline"), UDP (best-effort — there's no
  reliable way to distinguish a silent UDP device from an unresponsive one),
  or ICMP (shells out to the OS `ping` command). Pick whichever matches your
  gear from `src/net/heartbeat.js`'s `method` option — the UI currently only
  exposes the polling interval; wire a method dropdown into `app.js` if you
  want to switch it from the UI.
- **Persistence** is a single JSON file for simplicity. Swap `src/store.js`
  for a SQLite-backed version (e.g. `better-sqlite3`) if the device count or
  concurrent-write needs grow — nothing else in the app talks to storage
  directly, only through that class.
- **Command syntax** for actual hardware (Crestron, Extron, Q-SYS, Sony,
  Samsung, etc.) isn't baked in. Punch each brand's ASCII/hex strings into
  the mapping matrix per device — the console tab is also useful for probing
  a new device's protocol by hand before wiring up the control page.

## Next steps

- Add a method selector (TCP/UDP/ICMP) to the heartbeat UI.
- Persist and reopen the last-used console payload/encoding per device.
- Export/import device lists and mappings as JSON for backing up a room's config.
- Swap the JSON store for SQLite if you outgrow it.

## Device Test notes

- Uses the standard browser media APIs inside Electron, so any camera, mic or
  speaker Windows exposes works — USB, Bluetooth or built-in.
- On Windows, camera/microphone access must be enabled under
  Settings > Privacy & security > Camera / Microphone, including
  "Let desktop apps access your camera/microphone".
- Camera and mic are only opened while the Device Test tab is visible and are
  released when you switch away.

## What's new in 0.2.0

- **Control page** now has Power on / Power off, and Volume, Mute and Source
  controls are always visible. Buttons with a dashed outline have no command
  mapped yet (set them under "Edit command mapping").
- **Auto-discovery**: ports are optional. Leave the box empty and the scan
  pings every address and checks 20 common AV ports. Targets can be a CIDR
  (`192.168.1.0/24`), one IP, or a range (`192.168.1.10-40`). Results show
  hostname, MAC address, which ports answered, and can be stopped mid-scan.
  The panel can be hidden (and so can "Add device"); the choice is remembered.
- **Dark / Light theme** toggle in the sidebar, remembered between launches.
- **Software updates** (Settings tab): check, download and install new
  versions from inside the app.

## What's new in 0.3.0

- **Automatic updates.** The app checks GitHub Releases at start and every hour, downloads new versions in the background, and installs them when you close it. A banner offers "Restart now" if you don't want to wait. Devices, mappings and settings are kept.

## Publishing updates

Pushing to the `main` branch is publishing. GitHub Actions (`.github/workflows/release.yml`) builds the Windows installer, numbers it automatically (`0.4.<run number>`), and publishes it to GitHub Releases. Installed copies check every hour, download the new version in the background and install it when the app is closed (or straight away with "Restart now"). To change the major or minor number, edit `version` in `package.json`.

The repository must stay public so installed apps can read its releases.
