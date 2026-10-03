# Bound runaway visible summaries
Observed two rejected summaries substantially larger than their raw batches. Existing post-generation rejection preserves context but cannot bound visible output work.
- [x] Add failing stream-boundary regression before implementation.
- [x] Use a per-call abort controller linked to user cancellation; cap received visible characters (not tokens or opaque reasoning).
- [x] Discard the entire partial summary, preserve original results, use existing oversized/frontier behavior, never start another request.
- [x] Preserve reported usage after abort; unavailable usage stays unknown.
- [x] Run boundary/usage/package checks and rebuild committed bundle (17 tests passed).
- [x] GitHub CI passed; merged and reinstalled unversioned main a27840c. Fresh installed-stack SDK smoke passed. Original running sessions still require reload/restart; no hot-swap claim.
