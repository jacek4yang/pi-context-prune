import { createHash } from "node:crypto";

/** Private-content-free fingerprint; callers supply identities and immutable entry IDs only. */
export function pruneFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** No frontier advancement on failure. Identity failures wait for changed state/reload;
 * other failures can retry after a minute (or immediately when relevant state changes).
 */
export class PruneRetryGuard {
  private failure?: { key: string; until: number };
  reset(): void {
    this.failure = undefined;
  }
  blocked(key: string, now = Date.now()): boolean {
    return this.failure?.key === key && now < this.failure.until;
  }
  fail(key: string, error: unknown, now = Date.now()): void {
    const message = error instanceof Error ? error.message : String(error);
    const deterministic =
      /Checkpoint .*mismatch|Native replay|Orphan native sentinel|unknown provider/i.test(
        message,
      );
    this.failure = { key, until: deterministic ? Infinity : now + 60_000 };
  }
}
