# fast-glob compatibility adapter

PhotoSweep's pinned Plasmo resolver and CLI use `fast-glob` for asynchronous
file searches with `cwd` and `onlyFiles`. This package provides that surface,
plus the matching sync and helper exports, through `tinyglobby`.

Keep this adapter scoped to those call sites. Add a regression test before
expanding the supported API. The replacement removes the vulnerable
`fast-glob` → `micromatch` → `braces` chain; the advisory currently has no
patched `braces` release.
