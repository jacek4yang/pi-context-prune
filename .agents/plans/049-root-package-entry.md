---
name: 049-root-package-entry
description: Use a root compiled entry so Pi shows the package name instead of dist.
steps:
  - phase: implementation
    steps:
      - "- [x] Add root JS entry and preserve compiled-only tarball contract"
  - phase: validation
    steps:
      - "- [x] Verify packaged loading and startup labels; install local snapshot"
---
# 049 — Root package entry

- [x] Add root JS entry and preserve compiled-only tarball contract
- [x] Verify packaged loading and startup labels; install local snapshot

Only presentation/packaging changes. No pruning behavior or session/config changes.
Keep source index.ts as the esbuild input; expose root index.js to Pi.
