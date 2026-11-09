#!/usr/bin/env python3
"""Build packages/countries/cy/data/cy-dtm-index.json: the DLS elevation tile index.

Source: DLS INSPIRE Elevation (EL1) download feed
  https://eservices.dls.moi.gov.cy/inspire/rest/directories/arcgisforinspire/INSPIRE/EL1_MapServer/datasetatoma1.xml
  - tile index (shapefile, ETRS89 lat/lng): Pancyprian Index_2500X2500_ETRS89.zip, pin "XXXX-YYYY"
  - tiles: /inspire_downloads/EL/rasters/<year>_DTM/ETRS89_XXXX_YYYY.tif (GeoTIFF, float32, 1 m)
Licence (dataset metadata): CC BY-SA 4.0, no access constraints.

Output rows: [pin, west, south, east, north, flags] with flags bit 1 = 2019 DTM, bit 2 = 2014 DTM, bit 4 = 2019 DSM.
Usage: python3 tools/build_cy_dtm_index.py
"""
import io, json, re, struct, urllib.request, zipfile, datetime, os

BASE = "https://eservices.dls.moi.gov.cy/inspire_downloads/EL"
OUT = os.path.join(os.path.dirname(__file__), "..", "packages", "countries", "cy", "data", "cy-dtm-index.json")


def get(url: str) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "plotcheck-index-builder"}), timeout=120) as r:
        return r.read()


def read_index():
    z = zipfile.ZipFile(io.BytesIO(get(f"{BASE}/Pancyprian_Index_2500X2500_ETRS89/Pancyprian%20Index_2500X2500_ETRS89.zip")))
    shp = z.read(next(n for n in z.namelist() if n.endswith(".shp")))
    dbf = z.read(next(n for n in z.namelist() if n.endswith(".dbf")))
    n, hl, rl = struct.unpack("<IHH", dbf[4:12])
    fields, p = [], 32
    while dbf[p] != 0x0D:
        fields.append((dbf[p:p + 11].split(b"\0")[0].decode(), dbf[p + 16]))
        p += 32
    pins = []
    for i in range(n):
        r, o, rec = dbf[hl + i * rl + 1:hl + (i + 1) * rl], 0, {}
        for f, ln in fields:
            rec[f] = r[o:o + ln].decode("latin1").strip()
            o += ln
        pins.append(rec["pin"])
    boxes, off = [], 100
    while off < len(shp):
        _, clen = struct.unpack(">II", shp[off:off + 8])
        boxes.append(struct.unpack("<4d", shp[off + 12:off + 44]))
        off += 8 + clen * 2
    return list(zip(pins, boxes))


def listing(year: str) -> set:
    html = get(f"{BASE}/rasters/{year}/").decode("latin1")
    return set(re.findall(r"ETRS89_(\d+_\d+)\.tif\"", html))


def main():
    have = {"2019_DTM": listing("2019_DTM"), "2014_DTM": listing("2014_DTM"), "2019_DSM": listing("2019_DSM")}
    rows = []
    for pin, (w, s, e, n) in read_index():
        key = pin.replace("-", "_")
        flags = (1 if key in have["2019_DTM"] else 0) | (2 if key in have["2014_DTM"] else 0) | (4 if key in have["2019_DSM"] else 0)
        if flags:
            rows.append([pin, round(w, 5), round(s, 5), round(e, 5), round(n, 5), flags])
    data = {
        "source": "DLS INSPIRE Elevation (EL1): DTM 2019/2014 and DSM 2019, 1 m tiles, CC BY-SA 4.0",
        "extracted": datetime.date.today().isoformat(),
        "base": f"{BASE}/rasters",
        "tiles": rows,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))
    print(len(rows), "tiles →", OUT)


if __name__ == "__main__":
    main()
