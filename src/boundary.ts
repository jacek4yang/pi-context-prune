import type { SessionEntry } from "@earendil-works/pi-coding-agent";

/** Same typed history boundary as Pi, without interpreting any summary/checkpoint. */
export function compactionBoundary(branch: readonly SessionEntry[]): {
  id: string | null;
  start: number;
} {
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type !== "compaction") continue;
    if (entry.firstKeptEntryId === entry.id)
      return { id: entry.id, start: i + 1 };
    const kept = branch.findIndex((e) => e.id === entry.firstKeptEntryId);
    // A malformed boundary must not resurrect summarized history.
    if (kept < 0 || kept > i)
      throw new Error(
        "Invalid compaction boundary; reload or repair the session before pruning",
      );
    return { id: entry.id, start: kept };
  }
  return { id: null, start: 0 };
}
