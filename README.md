# ARTEMIS R69 v6 — Firmware Intelligence

Mobile-first local firmware inspection workspace for the Allwinner R69 investigation.

## Features
- Browser-local inspection of selected firmware files; file contents are not uploaded to the server.
- Parses `sys_config.fex` DRAM key/value settings.
- Parses `[partition]` sections in `sys_partition.fex`, treating each sector as 512 bytes as specified by the supplied format.
- Scans binary files for known signatures and printable strings.
- Optional WebUSB descriptor identification for VID `1F3A`, PID `EFE8`.
- Flash Center is intentionally read-only.

## Important limits
- DRAM settings are firmware configuration, not a live physical RAM read.
- A U-Boot string mentioning MMC/eMMC is not proof that the target storage was detected.
- WebUSB device selection only reads USB descriptor fields. It does not issue FEL commands, dump RAM, erase, burn, or write.
- Partition totals do not establish the actual eMMC capacity, especially when `UDISK` has no explicit size.
- No automated bootloader writing is included. Confirming board revision, exact SoC, storage layout and image compatibility requires qualified hardware verification.

## Deploy on Render
Create a new Web Service from this repository:
- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`

Or use the included `render.yaml`.

## Run locally
```bash
npm start
```
