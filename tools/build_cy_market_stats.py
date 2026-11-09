#!/usr/bin/env python3
"""Build packages/countries/cy/data/cy-sales-stats.json from the DLS open data on data.gov.cy:
"Στατιστικά Πωλήσεων - Μεταβιβάσεων Ακινήτων" (CC BY 4.0), one CSV per year:
MONTH, DISTRICT, Cases, Temaxia, Total Declared Amount, Total Accepted Amount.

These are monthly totals per district for all kinds of property together (land, houses, flats,
shops); they give market activity and the average value per sale, not prices per m².
Usage: python3 tools/build_cy_market_stats.py
"""
import csv, datetime, io, json, os, re, urllib.parse, urllib.request

PAGE = "https://www.data.gov.cy/el/dataset/statistika-poliseon-metabibaseon-akiniton"
OUT = os.path.join(os.path.dirname(__file__), "..", "packages", "countries", "cy", "data", "cy-sales-stats.json")


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "plotcheck-data-builder"}), timeout=120) as r:
        return r.read()


def main():
    html = get(PAGE).decode("utf-8", "replace")
    links = sorted(set(re.findall(r'href="(/sites/default/files/[^"]+?\.csv)"', html)))
    rows = {}
    for href in links:
        year = re.search(r"(20\d\d)", urllib.parse.unquote(href))
        if not year:
            continue
        text = get("https://www.data.gov.cy" + href).decode("utf-8-sig", "replace")
        for r in csv.DictReader(io.StringIO(text)):
            month, district = (r.get("MONTH") or "").strip(), (r.get("DISTRICT") or "").strip()
            m = re.match(r"(\d{1,2})/(\d{4})", month)
            if not m or not district or not (r.get("Cases") or "").strip():
                continue
            key = f"{m.group(2)}-{int(m.group(1)):02d}"
            num = lambda k: float((r.get(k) or "0").replace(",", "") or 0)
            rows[(key, district)] = [key, district, int(num("Cases")), int(num("Temaxia")), round(num("Total Declared Amount")), round(num("Total Accepted Amount"))]
    data = {
        "source": "Τμήμα Κτηματολογίου και Χωρομετρίας — Στατιστικά Πωλήσεων - Μεταβιβάσεων Ακινήτων (data.gov.cy, CC BY 4.0)",
        "url": PAGE,
        "extracted": datetime.date.today().isoformat(),
        "columns": ["month", "district", "cases", "plots", "declared", "accepted"],
        "rows": sorted(rows.values()),
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(len(data["rows"]), "rows, latest", max(r[0] for r in data["rows"]), "→", OUT)


if __name__ == "__main__":
    main()
