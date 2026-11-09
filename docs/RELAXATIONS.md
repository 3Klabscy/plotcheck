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
| `cy.lca.unified-complex` / `social-complex` | +5% / +25% for 4+ plots (cap +30% with RES) | Conditional | note (needs merged plots) | Larnaca LP ch. 12.8 — secondary |
| `cy.lca.listed-transfer` | +5–25% via transfer from a listed building (Κ.Δ.Π. 89/2015) | Conditional, cost | yes | Secondary |
| `cy.lca.urban-kep` / `urban-axis` | City centre streets/axes: +20% / +30–50%, floors, coverage limits | Conditional | note (road frontage not yet checked) | Larnaca LP ch. 11.6 — secondary |

## Sources

- Order 4/2026 (full text): https://www.etek.org.cy/uploads/2026/53422da1f0.pdf
- Order 4/2025 notice: https://eoal.org.cy/dimosiefsi-entolis-4-2025-gia-afxisi-tis-energeiakis-apodosis-anaptyxeon/
- Incentives scheme, Cabinet proposal 15/12/2023: https://eoal.org.cy/wp-content/uploads/2024/07/Kin_an_13.pdf
- Scheme extension (gov.cy): https://www.gov.cy/esoterika-themata/epekteinetai-i-ischys-tou-schediou-parochis-poleodomikon-kinitron-gia-anakampsi-tis-epicheirimatikis-drastiriotitas-stin-kypro/
- Larnaca incentives guide (secondary): https://www.axiavaluers.com/en/news/36
- Family extra-floor scheme: https://cyprus-mail.com/2026/09/17/ministry-unveils-new-scheme-allowing-families-to-build-extra-floor-for-relatives

## To do

- Confirm the affordable-housing scheme's current terms and whether it applies after 31/12/2025.
- Read Order 4/2025 itself, including its energy thresholds.
- Check the Larnaca LP chapters 11.6 and 12.8 against the plan text.
- Add the incentive chapters of the other Local Plans (Nicosia, Limassol, Paphos, Famagusta)
  and of the Policy Statement.
- Check road frontage automatically (DLS road network) so the city-centre axis bonuses can be
  calculated instead of only listed.
- Local base boundary distances (Annex B §11.1 of each Local Plan) should replace the 3 m default.
