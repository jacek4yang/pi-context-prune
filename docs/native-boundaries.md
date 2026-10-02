# Native compaction boundaries and bounded retries

Local patch 2.1.1-local.1 (not an upstream/npm release).

The pruner is an independent summarizer: it sends eligible tool batches, never a
main-model checkpoint or response continuation token. Different primary and pruner
models are supported. A native-compaction provider extension must separately
isolate its main-session state; this patch alone cannot fix a wrapper that injects
the main checkpoint into every request.

## Selection and persistence

Capture follows Pi's newest typed compaction entry and firstKeptEntryId. A native
self-kept boundary excludes its entire old prefix. A text compaction retains its
explicitly kept tail. Global assistant-turn numbering is preserved, so persisted
frontiers work across multiple compactions and reload. Neither summary text nor
encrypted checkpoint data is inspected.

Raw session history and context_tree_query aliases remain intact. Only candidate
selection and future request context change. No user session migration is needed.

A concurrent boundary/session/tree change or cancellation invalidates in-flight
work before summary/index/frontier commit. Failed durable index writes do not
mark tools as summarized in memory.

## Failures

No frontier advancement is claimed for failed ranges. An in-memory SHA-256
fingerprint covers session/boundary, model/API/provider/base URL, reasoning and
candidate tool IDs, but not private content. Identical checkpoint incompatibilities
are suppressed until relevant state changes or explicit reload. Transient failures
have a 60-second cooldown. Recovery does not require deleting checkpoints or
matching the pruner model to the main model.

Retry suppression is per loaded extension instance; reload permits one repaired
attempt. A genuine UUID-changing native fork remains subject to the native
extension's ownership policy; this pruner does not rebind encrypted checkpoints.

## Tests

`npm test` runs the existing usage tests plus real-extension boundary tests:
24 compactions/72 prunes, monotonic frontier, no duplicate requests, bounded active
context, preserved raw history, same-session tree forks, disk reload/copied JSONL,
no eligible context, ordinary kept text tails, automatic mode, deterministic
retry suppression, transient cooldown, abort/stale results and failed persistence.
The provider is deterministic; this is not a claim about remote summary quality.

Build/package checks: `npm run check`. Source typecheck (when TypeScript is
available): `tsc --noEmit --target es2022 --module nodenext --skipLibCheck index.ts`.
