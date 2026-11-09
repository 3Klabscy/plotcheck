# Notices and credits

## Software

- **zoneR** — vibe-lab-gsd/zoneR, MIT License, © 2025 zoneR authors.
  The zoning-check logic in `packages/engine` (allowed / not allowed / maybe, first-matching
  condition, undecidable conditions → "maybe", min/max resolution) is adapted from zoneR.
- **Open Zoning Feed Specification (OZFS)** — vibe-lab-gsd/ozfs-standard, Harvard GSD VibeLab.
  The rules schema in `packages/core` (`constraints`, `min_val` / `max_val`, `expression`,
  `condition`, `min_max`, constraint names) follows OZFS, extended for metric European terms
  and a jurisdiction hierarchy. The repository has no explicit licence file; confirm terms
  with the authors before commercial launch.
- Turf.js (MIT), MapLibre GL JS (BSD-3-Clause), fast-xml-parser (MIT), i18next (MIT),
  Expo / React Native (MIT).

## Fonts and libraries in the app

- **Noto Sans** (Regular, Bold), `apps/app/assets/fonts/`: © The Noto Project Authors, SIL Open
  Font License 1.1 (`apps/app/assets/fonts/OFL.txt`). Embedded (subset) in the PDF reports.
- **pdf-lib** and **@pdf-lib/fontkit**: MIT licence. PDF report generation on the device.
- **read-excel-file**: MIT licence. Reading comparable-sales Excel files.

## Data

- Cadastral parcels, planning zones, orthophotos: **Department of Lands and Surveys,
  Republic of Cyprus** — INSPIRE services (eservices.dls.moi.gov.cy). Attribution is shown in
  the app. Confirm the terms of use for commercial redistribution (see TECHNICAL_PLAN §6).
- Ground elevation, contours and surface heights: **DLS Digital Terrain / Surface Models** (INSPIRE
  Elevation; DTM 2019/2014 and DSM 2019 1 m tiles, DTM 1993 5 m), **CC BY-SA 4.0** per the dataset metadata. Values are read on demand and not
  redistributed; the tile index (`packages/countries/cy/data/cy-dtm-index.json`, built by
  `tools/build_cy_dtm_index.py`) is derived from the DLS index and shared under CC BY-SA 4.0.
  Attribution: "Ψηφιακό Μοντέλο Εδάφους © Τμήμα Κτηματολογίου και Χωρομετρίας, CC BY-SA 4.0".
- District sales statistics (`packages/countries/cy/data/cy-sales-stats.json`, built by
  `tools/build_cy_market_stats.py`): DLS "Στατιστικά Πωλήσεων - Μεταβιβάσεων Ακινήτων",
  data.gov.cy, **CC BY 4.0**.
- Larnaca plan-street geometry (`packages/countries/cy/src/larnaca/streets.ts`): © OpenStreetMap
  contributors, ODbL 1.0 — the extract is shared under the same licence.
- Larnaca road names (`packages/countries/cy/data/larnaca-roads-dls.json`): road geometry from the
  DLS INSPIRE road network; names read from the **DLS road map of Larnaca** (Larnaka_gr.pdf,
  1:10,000) and matched to Cyprus Post spellings. DLS map copyright — **used with permission
  granted to the operator (confirmed by the client, 2026-11-09)**; keep the permission on file.
- Street names and postcodes (`packages/countries/cy/data/larnaca-streets-cypruspost.json`): Cyprus
  Post postcode file (postal_codes.xlsx, public download). **Used with permission granted to the
  operator (confirmed by the client, 2026-11-09).** Their official postcode API can keep it current.
- Street map tiles: © OpenStreetMap contributors (prototype only — the OSMF tile usage policy
  does not allow production app traffic; replace with a hosted tile provider).
