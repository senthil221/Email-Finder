// The live try order: your own finds rank the base patterns once there are
// enough of them, and scouts stop after the top few (the rest rarely win).
import type { Db } from "./db";
import { PATTERNS, rankPatterns, type BasePatternId, type Ladder } from "./patterns";
import { patternFinds } from "./repo";

export type LadderInfo = Ladder & {
  order: BasePatternId[];
  cap: number;
  source: "data" | "default";
  finds: number; // finds the ranking is based on
  minFinds: number;
};

function envNum(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 && process.env[name] !== "" && process.env[name] !== undefined ? v : fallback;
}

export async function loadLadder(db: Db): Promise<LadderInfo> {
  const cap = envNum("SCOUT_MAX_PATTERNS", 6); // 0 = try all 9
  const minFinds = envNum("LADDER_MIN_FINDS", 300);
  const rows = await patternFinds(db, envNum("LADDER_DAYS", 90));
  const finds = rows.filter((r) => PATTERNS.some((p) => p.id === r.pattern)).reduce((s, r) => s + r.n, 0);
  const useData = finds >= minFinds;
  return {
    order: useData ? rankPatterns(rows) : PATTERNS.map((p) => p.id),
    cap,
    source: useData ? "data" : "default",
    finds,
    minFinds,
  };
}
