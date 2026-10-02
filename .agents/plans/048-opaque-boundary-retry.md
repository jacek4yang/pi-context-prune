---
name: 048-opaque-boundary-retry
description: Respect compaction ownership and bound no-progress prune retries without changing raw history.
steps:
  - phase: discovery
    steps:
      - "- [x] Trace provider routing, branch capture and failure restore behavior"
  - phase: implementation
    steps:
      - "- [x] Respect typed compaction boundaries and reject stale in-flight work"
      - "- [x] Bound repeated failed ranges and preserve index persistence ordering"
  - phase: validation
    steps:
      - "- [x] Test actual extension routing, long cycles, resume and failures"
      - "- [x] Validate integrated Astra native checkpoint and Luna requests"
---
# 048 — Opaque boundary and retries

## Discovery
- [x] Trace provider routing, branch capture and failure restore behavior

The native-compaction extension owned the primary bug: its global Codex provider
wrapper replayed the main checkpoint into independent requests. That is fixed in
the native extension. This companion change addresses independently confirmed
pruner defects: whole-branch recapture crosses compaction boundaries, failed
ranges retry without progress, and stale in-flight results can be committed.

## Implementation
- [x] Respect typed compaction boundaries and reject stale in-flight work
- [x] Bound repeated failed ranges and preserve index persistence ordering

Use the latest typed compaction entry and its firstKeptEntryId, preserving kept
text tails and global assistant-turn numbering. Never inspect encrypted content.
Keep raw JSONL history and recovery aliases. Do not change configuration defaults.

## Validation
- [x] Test actual extension routing, long cycles, resume and failures
- [x] Validate integrated Astra native checkpoint and Luna requests
