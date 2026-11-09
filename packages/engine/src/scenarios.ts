import { USE_TYPES, type UseType } from "@plotcheck/core";
import { analyse } from "./analyse.ts";
import type { AnalysisInput, AnalysisResult } from "./types.ts";

/** "Show me all options": run every use type and rank permitted ones by achievable floor area. */
export function compareScenarios(input: Omit<AnalysisInput, "use">, uses: UseType[] = USE_TYPES): AnalysisResult[] {
  const rank = { allowed: 0, maybe: 1, not_allowed: 2 } as const;
  return uses
    .map((use) => analyse({ ...input, use }))
    .sort((a, b) => rank[a.status] - rank[b.status] || b.figures.achievableGfaM2 - a.figures.achievableGfaM2);
}
