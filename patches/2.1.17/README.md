# BOMD Bedrock 2.1.17 — Obsidilith reliability patch

This patch is based on the uploaded `BOMD_Bedrock_2.1.16` source package.

## Fixed

- Obsidilith locator no longer reports a planned arena that is blocked by a manual loaded-footprint check.
- `/scriptevent bomd:locate obsidilith` now requests arena placement immediately and reports a safe arrival Y plus the summon-frame Y.
- Obsidilith End Frame interaction now reads the player's selected inventory slot instead of the nonexistent `BlockComponentPlayerInteractEvent.itemStack` property.
- The End Frame accepts both an Eye of Ender and an Ender Pearl and consumes the item in Survival.
- Filled End Frames can resume an interrupted ritual.
- All Obsidilith End Frame material instances use `alpha_test`, eliminating opaque/transparent render-method mixing.
- Version bumped to 2.1.17 in the corrected package.

## Script API note

For Minecraft Bedrock 1.26.40, current Microsoft stable documentation lists `@minecraft/server` 2.8.0 as the stable dependency. It does not list a stable 2.9.0 for that line, so the corrected package intentionally retains 2.8.0 rather than publishing an unresolved dependency.

## Repository state

The repository default branch is still the older 1.5.4 source tree, while this patch was produced from the uploaded 2.1.16 package. The corrected 2.1.17 files are stored under this patch directory so the stale default branch is not partially overwritten with a newer source generation.
