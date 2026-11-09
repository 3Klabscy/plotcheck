"""Build the plot-search index for a Cyprus district from the DLS cadastral service.

Usage: python3 tools/build_cy_plot_index.py <district-digit> <codes.json> <out.json>
Output: municipality → sheet/plan → block (section-block) → plot count, plus names from the
CYSTAT geographic codes. Only plot references are read (no geometry, no personal data).
"""
import json, os, sys, time, urllib.parse, urllib.request
from collections import defaultdict

district, codes_file, out_file = sys.argv[1], sys.argv[2], sys.argv[3]
URL = "https://eservices.dls.moi.gov.cy/inspire/rest/services/INSPIRE/CP_CadastralParcels/MapServer/1/query"
opener = urllib.request.build_opener(urllib.request.ProxyHandler({"https": os.environ["HTTPS_PROXY"]})) if os.environ.get("HTTPS_PROXY") else urllib.request.build_opener()

def fetch(offset):
    q = urllib.parse.urlencode({"where": f"nationalCadastralRef LIKE '{district}%'", "outFields": "nationalCadastralRef",
                                "returnGeometry": "false", "orderByFields": "OBJECTID", "resultOffset": offset, "resultRecordCount": 1000, "f": "json"})
    for attempt in range(4):
        try:
            return json.load(opener.open(URL + "?" + q, timeout=120))["features"]
        except Exception as e:  # noqa: BLE001
            time.sleep(2 ** attempt)
    raise RuntimeError(f"failed at offset {offset}")

cache = out_file + ".refs.json"
if os.path.exists(cache):
    refs = json.load(open(cache))
else:
    refs, offset = [], 0
    while True:
        feats = fetch(offset)
        refs += [f["attributes"]["nationalCadastralRef"] or "" for f in feats]
        offset += len(feats)
        print(offset, end=" ", flush=True)
        if len(feats) < 1000: break
    json.dump(refs, open(cache, "w"))
index = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
for ref in refs:
    if True:
        parts = ref.split("-")
        if len(parts) != 5: continue
        muni, sheet, section, block, _plot = parts
        index[muni][sheet][f"{section}-{block}"] += 1

codes = json.load(open(codes_file))
out = {"source": "DLS INSPIRE cadastral parcels (references only) + CYSTAT geographic codes", "built": time.strftime("%Y-%m-%d"),
       "district": district, "municipalities": []}
for muni in sorted(index):
    c = codes.get(muni, {})
    out["municipalities"].append({"code": muni, "el": c.get("el"), "en": c.get("en"), "quarters": c.get("quarters", []),
        "sheets": {s: dict(sorted(b.items())) for s, b in sorted(index[muni].items())}})
json.dump(out, open(out_file, "w"), ensure_ascii=False, separators=(",", ":"))
print("\nmunicipalities:", len(out["municipalities"]), "sheets:", sum(len(m["sheets"]) for m in out["municipalities"]),
      "named:", sum(1 for m in out["municipalities"] if m["el"]))
