# Cyprus planning relaxations and incentives (χαλαρώσεις / κίνητρα)

Catalogue in `packages/countries/cy/src/relaxations.ts`. Researched 2026-11-09. Every entry is
`needs_review` until checked by a registered architect or engineer. All values are ceilings.

## How the app uses them

- **Island-wide** relaxations apply to every plot. **Area** ones (currently the Larnaca Local Plan,
  plan 401) are added for that plan only.
- The engine applies every relaxation it can quantify. It picks the largest density package that
  is legal (one national scheme per property, local caps, combinations not confirmed are not
  stacked) and lists the other packages as alternatives.
- Discretionary extra floors are used **only** as far as needed to build the extra density.
- Each result shows the base figures and the figures with relaxations, and lists every
  relaxation with its rule, conditions, cost and source. The rest are listed as notes.

## Catalogue

| Id | Grants | Tier | In figures | Source |
|---|---|---|---|---|
| `cy.o4-2026.verandas` | Verandas ≤25% of each floor not counted (35% at discretion) | As of right | yes (reported) | Order 4/2026 §2.2.15 — primary |
| `cy.o4-2026.basement` | Basement parking/storage/plant not counted | As of right | yes (reported) | Order 4/2026 §2.2.1 — primary |
| `cy.o4-2026.pilotis` | Pilotis parking + ancillary spaces ≤~35% not counted | Conditional | note | §2.2.7, §2.2.9 — primary |
| `cy.o4-2026.roof` | Attic ≤2.40 m; roof structures ≤35% of the roof | As of right | note | §2.2.14, §4.3 — primary |
| `cy.o4-2026.office-height` | +0.70 m height per floor (offices/commercial; not in cores or historic centres) | Conditional | yes | §4.1.1 — primary |
| `cy.o4-2026.extra-floors` | Up to +2 floors (Local Plans) / +1 (Policy Statement) | Discretionary | only to fit bonuses | §4.1 — primary |
| `cy.o4-2026.continuous` | 0 m side distances in continuous-building zones | Discretionary | yes | §5.1.1(α) — primary |
| `cy.o4-2026.upper-setbacks` | Reduced distances from the 4th floor up; balconies 1.50 m | Discretionary | note | §5.8, §5.2 — primary |
| `cy.o4-2026.coverage` | Coverage adjustment cases | Discretionary | note | §3 — primary |
| `cy.o4-2026.slope` | +1 floor on steep ground | Discretionary | note | §4.2 — primary |
| `cy.o4-2025.res` | +5% density for energy performance / RES | Conditional | yes | Order 4/2025 (replaces 1/2020) — publication notices |
| `cy.scheme.affordable-45` | Up to +45% density, part of the extra units affordable (KOAG) | Conditional, obligation | yes | Gov.cy; press 2025–26 — **status after 31/12/2025 to confirm** |
| `cy.scheme.buyout-25` | ~+25% density for a payment into the Affordable Housing Fund | Conditional, cost | alternative | Secondary (Axia) |
| `cy.scheme.recovery` | Buy extra density at 50% (70% outside designated areas) of its value | Conditional, cost | note | Cabinet proposal 15/12/2023 — primary |
| `cy.scheme.family-floor` | Extra floor or unit for family, ~150/180 m², existing houses, to end of 2027 | Conditional | note | Press 09/2026 — scheme guide to check |
| `cy.lca.unified-complex` / `social-complex` | +5% / +25% for 4+ normal plots; with RES max +30% | Conditional | note (needs merged plots) | Larnaca LP 2019 §12.8 — **primary** |
| `cy.o4-2025.res` (Larnaca residential) | +5% within the §12.8 +30% cap (Κα/Πα/ΚΓ outside the Urban Centre) | Conditional | yes | Larnaca LP §12.8.2(γ) — **primary** |
| `cy.lca.res-extra-floor` | +1 floor with reduced coverage when §12.8 incentives are used | Discretionary | note | §12.8.3(δ) — **primary** |
| `cy.lca.urban-kep` | Central Commercial Area streets: +20% (central-use share >60%), +2 floors, coverage 0.40/0.55, plot ≥1,000 m² | Conditional | yes, if frontage detected; commercial/mixed only | §11.6.2 — **primary** |
| `cy.lca.urban-axis-30` / `-50` | Makariou III, Gr. Afxentiou, Artemidos (north): +30% (1,000–4,000 m²) / +50% (>4,000 m²), up to 12 floors, coverage 0.35, distances 3 m (ground, 1st) / 5 m | Conditional | yes, if frontage detected; commercial/mixed only | §11.6.3 — **primary** |
| `cy.lca.uc-housing-mix` | +15% where ≥20% of the floor area is housing (ΚΕΠ/axes) | Conditional | yes, if frontage detected | §11.6.4.1 — **primary** |
| `cy.lca.uc-residential` | Urban Centre residential zones: +25% / +30%, +2 floors | Conditional | note (Urban Centre boundary not yet digitised) | §11.6.4.2 — **primary** |
| `cy.lca.listed-transfer` | +5–25% via transfer from a listed building (Κ.Δ.Π. 89/2015) | Conditional, cost | yes | Receiving-zone limits — secondary (Axia) |

All Urban Centre bonuses need a listed-building transfer equal to 20% of the bonus (§11.6.5α). They
don't apply in Areas of Special Character or Antiquities-controlled areas. Combined, they may reach
+100%, capped at 4.00:1.

### Larnaca dwelling standards (in the calculation)

- **Minimum usable area** (Table 12.1, outside the Urban Centre): studio 35 m², 1-bed 50 m²,
  2-bed 75 m², 3-bed 95 m². In the Urban Centre: 30 / 45 / 65 / 85 m².
- **Studio share:** studios may not exceed 25% of the units in developments of 5 or more
  (§12.12.8).

### Boundary distances (in the calculation)

- **Base rule** (Local Plans Annex B §11.1(ε), via the ETEK 2025 guide, Diagram 37): 3 m up to
  the 3rd floor, 4 m on the 4th, 5 m from the 5th floor up. The engine computes each floor's
  plate on the real plot shape.
- **Reductions** (Order 4/2026 §5.8): the authority may reduce the upper-floor distances; this
  is used in the relaxed scenario.

### Road access, street names and postcodes (Larnaca)

`packages/countries/cy/src/larnaca/roads.ts` provides, for every plot in the Larnaca map area,
the streets it fronts (with length), their postcodes and a road-access check. If no road runs
along the plot boundary, the app shows a "no public road access" warning.

- **Road geometry:** 5,266 DLS road segments.
- **Names:** 988 street names, read from the DLS 1:10,000 road-map labels. The map was
  georeferenced to about 1.5 m and its labels rebuilt from fragments.
- **Official spellings and postcodes:** from Cyprus Post.
- **Accuracy:** on the plan streets, 96% of the named length is correctly named. About half the
  length is still unnamed, where the map has no label nearby, so the OSM plan streets remain a
  second source for the city-centre bonuses.

### Street frontage (Larnaca, OSM plan streets)

`packages/countries/cy/src/larnaca/frontage.ts` detects which plan street a plot fronts, using
OSM street geometry (© OpenStreetMap contributors, ODbL, bundled extract dated 2026-11-09). These
streets are not covered yet:
- Plateia Vasileos Pavlou;
- Zinonos Pieridi;
- the part of Kalogera named in §11.6.2.1;
- the harbour-roundabout plots (§11.6.3.1).

## Sources

- Order 4/2026 (full text): https://www.etek.org.cy/uploads/2026/53422da1f0.pdf
- Order 4/2025 notice: https://eoal.org.cy/dimosiefsi-entolis-4-2025-gia-afxisi-tis-energeiakis-apodosis-anaptyxeon/
- Incentives scheme, Cabinet proposal 15/12/2023: https://eoal.org.cy/wp-content/uploads/2024/07/Kin_an_13.pdf
- Scheme extension (gov.cy): https://www.gov.cy/esoterika-themata/epekteinetai-i-ischys-tou-schediou-parochis-poleodomikon-kinitron-gia-anakampsi-tis-epicheirimatikis-drastiriotitas-stin-kypro/
- Larnaca Local Plan 2019 (full text): https://eoal.org.cy/wp-content/uploads/2024/07/Top_sx_3.pdf
- ETEK guide to planning regulations (2025): https://www.etek.org.cy/uploads/2025/d2d58622Yh.pdf
- Larnaca incentives guide (secondary): https://www.axiavaluers.com/en/news/36
- Family extra-floor scheme: https://cyprus-mail.com/2026/09/17/ministry-unveils-new-scheme-allowing-families-to-build-extra-floor-for-relatives

## To do

- Confirm the affordable-housing scheme's current terms and whether it applies after 31/12/2025.
- Read Order 4/2025 itself, including its energy thresholds.
- Add the incentive chapters of the other Local Plans (Nicosia, Limassol, Paphos, Famagusta)
  and of the Policy Statement.
- Check road frontage automatically (DLS road network) so the city-centre axis bonuses can be
  calculated instead of only listed.
- Digitise the Larnaca Urban Centre boundary (Plan No. 6) so §11.6.4.2 can be calculated.
- Read Annex B itself (not only the ETEK summary) for the front/road distances.

## Restrictions (Larnaca / Cyprus)

`packages/countries/cy/src/restrictions.ts`. These are checked when the plot is selected, before
any calculation. The engine applies the effects (block / height cap / floor cap), and these also
hold in the relaxed scenario.

| Layer | Source | Effect |
|---|---|---|
| Airport Public Safety Zones 100×600 m and 350×3,500 m | Larnaca LP §32.4.1. Geometry is approximated from the stated dimensions and the runway ends (OSM); check against Plan 13/13A | Not permitted |
| Airport height limit | ICAO Annex 14 surfaces for runway 04/22 (code 4 precision): inner horizontal 45 m, conical 5%, approach 2%/2.5%, transitional 14.3%; aerodrome elevation 2.4 m | Height cap = surface altitude − ground elevation from the DLS terrain model (DTM 2019, 1 m; 2014 / 1993 fallback), taking the most limiting of ~10 points on the plot |
| Airport noise zones (Lnight 60 dB(A)) | Larnaca LP §32.4.2, §32.5: Γρ1 (offices, 2 floors), Εβ7γ, ΕΔΑ1α, Τ3β(Ε) | Note; Γρ1 capped at 2 floors |
| Flood zones (20/100/500-year) | DLS INSPIRE NZ (Water Development Department flood maps) | Critical (20 yr) / warning (100 yr) / note (500 yr) |
| Natura 2000 | EEA Natura 2000 service (EU-wide), e.g. CY6000002 Larnaca Salt Lakes | Critical: Appropriate Assessment |
| Forest Department protected sites | DLS INSPIRE PS | Warning |
| Coastal zone (within 100 m of the shoreline) | DLS INSPIRE SR shoreline; Foreshore Protection Law Cap. 59; LP Appendix 3 | Warning |

Still to add:
- Department of Antiquities controlled areas and archaeological sites (Kition and others): no
  open digital source found yet;
- the official PSZ and noise-contour geometry (Plans 8, 13, 13A);
- ground elevation for an exact height cap;
- road widening / street alignment plans.
