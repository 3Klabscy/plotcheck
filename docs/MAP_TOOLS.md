# Map tools and plot search (PAL Maps parity, own design)

Goal (client, 2026-11-09): every tool that PAL Maps (maps.palsurveying.com) offers, with our own
look, and plot search that works the same way as the DLS cadastre portal.

The list below comes from PAL's public feature page (palsurveying.com/maps, read 2026-11-09). We
copy no PAL code, design or data. Every layer comes from the public DLS INSPIRE services, or from
data the client has permission to use (DLS road map, Cyprus Post).

## Plot search (as the DLS portal)

| DLS / PAL search | Status |
|---|---|
| Sheet/plan: district → municipality → quarter → sheet/plan → block → plot | ✅ Larnaca district |
| By plot: municipality (+ quarter/sheet/block optional) + plot number → list of matches | ✅ DLS REST `LIKE` query, ~1 s |
| By address (street) | ✅ Larnaca urban area (DLS road map + Cyprus Post), Greek or Latin, abbreviations |
| By registration number | ⏳ Not in the open data. Needs access to the DLS eServices (API); shown disabled with a note |
| Geo-ID | ⏳ Unclear what PAL means by this; to be confirmed |
| Find a plot by number in the current view | ✅ «Αρ. τεμαχίου εδώ» (DLS query on the visible area) |
| Saved / recent searches | ⏳ With user accounts |
| Other districts | ⏳ After Larnaca (`tools/build_cy_plot_index.py`) |

## Layers (all DLS, drawn through the services' ArcGIS `export`)

| PAL layer | Ours |
|---|---|
| Orthophotos 1963, 1993, 2014, 2019 | ✅ (1963/1993 reprojected by the DLS server from the Cyprus grid) |
| Cadastral parcels, buildings | ✅ |
| Quarters / sections, administrative boundaries | ✅ |
| Town-planning zones | ✅ |
| Flood zones, seismic zones, geological hazards | ✅ |
| Coastal protection | ✅ Shoreline layer (the protection zone itself is checked per plot in Restrictions) |
| Natura 2000 and protected sites | ✅ |
| Geology | ✅ Geological units. ⏳ GSD "geological suitability zones 2025" are not on DLS INSPIRE |
| Water and sewer networks, public buildings | ✅ (Utilities layer) |
| Road / topographic map | ✅ OSM streets (prototype tiles; hosted provider in phase 3) |
| White zones, listed buildings, green/community spaces, state land | ⏳ Not found on DLS INSPIRE; need the Town Planning Department's data |
| Dam protection zones, bird corridors, HV power lines | ⏳ Source to be found |
| Google / Bing / Esri satellite | ✗ Licence does not allow this use; the DLS orthophotos are better locally |
| Contour lines | ✅ From the DLS DTM 2019 (open download, CC BY-SA 4.0), worked out by the server for the view (zoom ≥ 16), interval chosen by relief (0.5–100 m), labels every 5th line. Hillshade 1993 layer too |

## Tools

| PAL tool | Status |
|---|---|
| Distance and area measurement | ✅ |
| Share a link to a plot or view | ✅ `?ref=` and `?lng&lat&z` |
| Export to KML | ✅ Selected plot and all drawings: KML, GeoJSON, **DXF in CGRS93**. ⏳ KMZ |
| Import GeoJSON / DXF / KML | ✅ DXF in CGRS93 (LWPOLYLINE, POLYLINE, LINE, POINT) or lng/lat; KML; GeoJSON |
| Drawing tools | ✅ Points, lines, shapes (from the measuring tools, «Κράτησε στον χάρτη»); list, zoom, delete |
| Download the official cadastral map | ⏳ Official copies come from the DLS eServices (paid); we will link to them |
| Coordinates in CGRS 1993 | ✅ Live under the cursor and the plot centre. EPSG:6312 with the EPSG:7721 shift reversed (coordinate frame) = what the DLS GeometryServer applies; matches it to < 5 mm and puts the DLS DTM tile corners exactly on the 2.5 km grid |
| Assessed value and building coefficient | ✅ Building coefficients per plot. DLS General Valuation 2021 per area and zone in Finance. ⏳ Per-plot value needs the DLS eServices |
| Survey plan sheets | ⏳ |
| Ground elevation of the plot | ✅ DLS DTM 2019 (1 m) → 2014 → 1993 (5 m) |
| What stands on the plot (buildings/trees, height) | ✅ DLS DSM 2019 − DTM 2019 inside the plot (buildings and trees not told apart) |
