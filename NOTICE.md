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

## Data

- Cadastral parcels, planning zones, orthophotos: **Department of Lands and Surveys,
  Republic of Cyprus** — INSPIRE services (eservices.dls.moi.gov.cy). Attribution is shown in
  the app. Confirm the terms of use for commercial redistribution (see TECHNICAL_PLAN §6).
- Larnaca plan-street geometry (`packages/countries/cy/src/larnaca/streets.ts`): © OpenStreetMap
  contributors, ODbL 1.0 — the extract is shared under the same licence.
- Larnaca road names (`packages/countries/cy/data/larnaca-roads-dls.json`): road geometry from the
  DLS INSPIRE road network; names read from the **DLS road map of Larnaca** (Larnaka_gr.pdf,
  1:10,000) and matched to Cyprus Post spellings. **DLS map copyright: any use beyond personal use
  needs written permission from DLS** (ayiannakou@dls.moi.gov.cy). Development use only until
  confirmed.
- Street names and postcodes (`packages/countries/cy/data/larnaca-streets-cypruspost.json`): Cyprus
  Post postcode file (postal_codes.xlsx, public download). Reuse terms to be confirmed with Cyprus
  Post; their official postcode API is the intended production source.
- Street map tiles: © OpenStreetMap contributors (prototype only — the OSMF tile usage policy
  does not allow production app traffic; replace with a hosted tile provider).
