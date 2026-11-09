import { describe, expect, it } from "vitest";
import { evaluate, ExprError, resolveBound, resolveRules, constant, type RuleLayer } from "../src/index.ts";

describe("evaluate", () => {
  it("handles arithmetic, comparisons, logic and min/max", () => {
    expect(evaluate("25 + (height - 35)", { height: 40 })).toBe(30);
    expect(evaluate("height <= 35 and stories < 3", { height: 30, stories: 2 })).toBe(true);
    expect(evaluate("not (1 > 2) or False")).toBe(true);
    expect(evaluate("max(5, 0.1 * lot_width)", { lot_width: 80 })).toBe(8);
    expect(evaluate("-2 * 3 % 4")).toBe(2); // Python semantics
  });
  it("rejects anything unsafe or unknown", () => {
    expect(() => evaluate("__import__('os')")).toThrow(ExprError);
    expect(() => evaluate("Parcel abuts R-1")).toThrow(ExprError);
    expect(() => evaluate("x + 1")).toThrow(/unknown variable/);
  });
});

describe("resolveBound (zoneR semantics)", () => {
  it("first matching condition wins", () => {
    const b = resolveBound([{ condition: "height <= 35", expression: 25 }, { condition: true, expression: "25 + (height - 35)" }], { height: 40 });
    expect(b?.values).toEqual([30]);
    expect(b?.ambiguous).toBe(false);
  });
  it("text conditions give ambiguous candidates (maybe)", () => {
    const b = resolveBound([{ condition: "Parcel abuts R-1", expression: 10 }, { condition: true, expression: 5 }], {});
    expect(b?.values.sort()).toEqual([10, 5].sort());
    expect(b?.ambiguous).toBe(true);
  });
  it("min_max picks one of several expressions", () => {
    expect(resolveBound([{ expression: [5, "0.1 * lot_width"], min_max: "max" }], { lot_width: 80 })?.values).toEqual([8]);
  });
});

describe("resolveRules hierarchy", () => {
  const p = { source: "t", status: "verified" as const };
  const layers: RuleLayer[] = [
    { level: "country", match: { path: ["XX"] }, constraints: { setback_dist_boundary: constant("min", 3, p), far: constant("max", 0.5, p) } },
    { level: "source", match: { path: ["XX"], dist_abbr: "A1" }, constraints: { far: constant("max", 1.2, { ...p, status: "needs_review" }) } },
    { level: "zone", match: { path: ["XX"], dist_abbr: "A1" }, constraints: { far: constant("max", 1.1, p) } },
    { level: "zone", match: { path: ["XX"], dist_abbr: "B1" }, constraints: { far: constant("max", 9, p) } },
  ];
  it("zone overrides source overrides country, per constraint", () => {
    const r = resolveRules({ path: ["XX", "R", "M"] }, "A1", layers);
    expect(r.constraints.far?.max_val?.[0]?.expression).toBe(1.1);
    expect(r.constraints.setback_dist_boundary?.min_val?.[0]?.expression).toBe(3);
    expect(r.curated).toBe(true);
  });
  it("source data alone is not curated", () => {
    const r = resolveRules({ path: ["XX"] }, "A1", layers.slice(0, 2));
    expect(r.curated).toBe(false);
    expect(r.constraints.far?.provenance.status).toBe("needs_review");
  });
});
