# ARTEMIS R69 — Hardware Compatibility Intelligence v5.0

Complete static-site replacement for the R69 diagnostic workspace.

## Included
- Arabic RTL responsive interface.
- Local chunked firmware signature scan (4 MiB chunks).
- JSON diagnostic export.
- WebUSB descriptor inspection for the selected USB device.
- Hardware evidence register for PCB, DRAM, eMMC, partition-map and independent-review references.
- Report clearly separates user-entered evidence from independently verified facts.
- Persistent Flash Center lock; no FEL command, RAM access, code execution, erase, or eMMC write is implemented.

## Deploy on Render
- Service type: Static Site
- Build command: leave empty
- Publish directory: `.`
- Serve over HTTPS for WebUSB.

## Important limitations
USB VID/PID and descriptor access do not prove a complete FEL handshake or identify the PCB. A firmware signature scan does not parse or validate every IMAGEWTY entry, checksum, partition offset, DRAM profile, or bootloader compatibility. Values entered in the hardware evidence register are not authenticated by the app. A qualified technician must independently verify the exact PCB revision and memory components using reliable board documentation.

Do not open or electrically modify the device as part of this software workflow. If physical markings are needed, have a qualified technician inspect the board and provide the documented values.

## Files
- `index.html`
- `style.css`
- `app.js`
- `README.md`
- `BUILD_INFO.json`

No manual script insertion is required; `index.html` already loads `app.js`.
