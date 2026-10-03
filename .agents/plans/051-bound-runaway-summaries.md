# Bound runaway visible summaries
Observed two rejected summaries substantially larger than their raw batches. Existing post-generation rejection preserves context but cannot bound visible output work.
- [x] Add failing stream-boundary regression before implementation.
- [x] Use a per-call abort controller linked to user cancellation; cap received visible characters (not tokens or opaque reasoning).
- [x] Discard the entire partial summary, preserve original results, use existing oversized/frontier behavior, never start another request.
- [x] Preserve reported usage after abort; unavailable usage stays unknown.
- [ ] Run boundary/usage/package checks and update committed bundle; CI then rollout.
