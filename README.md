# ARTEMIS R69 — Complete Diagnostic Build 4.0

This ZIP is a complete static-site replacement. Upload/replace the repository contents with these files; no extra script insertion is required.

## Files
- `index.html` — complete Arabic RTL interface.
- `style.css` — responsive dark interface.
- `app.js` — local firmware signature scanner, JSON reporting, WebUSB descriptor inspection, diagnostic report, and guarded Flash Center.

## Deploy on Render
Create/use a **Static Site**:
- Build Command: leave empty
- Publish Directory: `.`
- No server, API key, package install, or build step is required.

The page must be served over HTTPS for WebUSB. Use a browser that supports WebUSB (for Android, Chrome is the usual option).

## What works
- Scans large firmware files locally in 4 MiB chunks.
- Detects selected signatures: IMAGEWTY, imgRePacker, eGON.BT0, ANDROID!, BOOTPKG, UBOOT_, TOC1 and AVB0.
- Exports a JSON report.
- Opens an allowed USB device and inspects configuration/interface/endpoint descriptors.
- Reports its findings and the current compatibility limitations.
- Does not upload firmware to a server.

## Flash safety
The Flash Center is intentionally locked. This build does not implement FEL memory writes, FEL execution, eMMC writes, partition erasure, or flashing. The available ROM/board evidence is not enough to safely determine the exact PCB revision, DRAM initialization profile, eMMC geometry, and compatible boot chain. A generic or guessed flashing path can permanently prevent boot.

The app does not claim that VID/PID selection is a complete FEL handshake. It inspects USB descriptors only. The AI-labelled panel is a transparent local rule-based diagnostic engine, not a remote LLM.

## Replace repository contents from a phone
1. Download and extract this ZIP.
2. In GitHub mobile, open the target repository and replace `index.html`, `style.css`, `app.js`, and `README.md` with the files from this ZIP (or upload the extracted folder contents).
3. Commit the replacement.
4. Render redeploys from the repository if auto-deploy is enabled.

No manual script line is required: `index.html` already loads `app.js`.
