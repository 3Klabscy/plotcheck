// Live smoke test against DLS (network). Usage: NODE_USE_ENV_PROXY=1 npx tsx tools/probe.ts [lng] [lat]
import { dlsInspireParcels, dlsPlanningZones } from "@plotcheck/country-cy";
const [lng = 33.615, lat = 34.93] = process.argv.slice(2).map(Number);
const ctx = { fetch: globalThis.fetch, env: (k: string) => process.env[k] };
const t0 = Date.now();
const parcels = await dlsInspireParcels.getByPoint(ctx, { lng, lat });
console.log(`parcels ${parcels.length} in ${Date.now() - t0}ms`, parcels.slice(0, 3).map((p) => [p.nationalRef, p.officialAreaM2, p.distanceM]));
const t1 = Date.now();
const zones = await dlsPlanningZones.zonesFor(ctx, parcels[0]!);
console.log(`zones in ${Date.now() - t1}ms`, zones.map((z) => [z.zoneCode, z.share, z.publishedConstraints, z.planName]));
