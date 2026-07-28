# Changelog

All notable changes to **Bosses of Mass Destruction: Bedrock Edition** are documented in this file.

This project is currently in public beta. Features, compatibility requirements, and internal systems may change between releases.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Planned

* Continue porting bosses and content from the original Java mod.
* Expand multiplayer and cross-device testing.
* Improve structure-generation reliability.
* Continue performance optimization and combat balancing.
* Resolve issues reported during the first public release.

---

## [1.5.4] — Soul Star Locator Stability

### Fixed

* Fixed repeated `Native setter cannot be assigned null or undefined` warnings during remote Night Lich Tower searches.
* Prevented incomplete candidate coordinates from being passed to native entity queries.
* Added safe horizontal filtering when a candidate's Y coordinate is not yet known.
* Invalid candidate coordinates now exit safely without invoking native queries.

### Changed

* Renamed the native structure command from:

```text
/bomd:locate
```

to:

```text
/bomd:find_structure
```

This avoids a conflict with Minecraft's vanilla `/locate` command.

### Compatibility

The following alternatives remain available:

```text
/scriptevent bomd:locate ...
/function bomd/locate/...
```

### Localization

* Rebuilt all `.lang` files as strict UTF-8.
* Removed byte-order marks, NUL bytes, CRLF line endings, and malformed entries.
* Added validation for control characters and localization syntax.

---

## [1.5.3] — Independent Soul Star Locator

### Added

* Added deterministic Night Lich Tower discovery using the world seed.
* Added temporary remote-region inspection for tower candidates.
* Added biome, terrain, liquid, slope, height, and structure-space validation.
* Added persistent storage for rejected regions and generated towers.
* Added serialization of simultaneous searches to prevent duplicate generation.

### Changed

* The Soul Star no longer requires a Night Lich Tower to have been previously loaded.
* Existing known towers are reused before attempting fallback generation.
* The Soul Star is not consumed while searching or when no valid candidate is found.

### Progression

* Night Lich Towers now store defeated status.
* Defeated towers are ignored by the Soul Star.
* Resetting a tower makes it available again.
* Killing the Night Lich updates both the structure registry and deterministic locator state.

---

## [1.5.2] — Structure Locator and Persistent Registry

### Added

* Added a native custom command for locating registered structures.
* Added coordinate-reporting and teleport modes.
* Added autocomplete for supported structure identifiers.
* Added `/scriptevent` and function-based compatibility alternatives.
* Added a persistent world-level structure registry.

### Supported structures

* Night Lich Tower.
* Nether Gauntlet Arena.

### Structure persistence

* Night Lich Towers are registered when their anchor initializes or loads.
* Nether Gauntlet Arenas are registered through their central rune system.
* Registered positions remain available after chunk unloading and world restarts.
* Nearby duplicate records are merged.
* The registry is limited to 192 records.

### Limitation

Naturally generated structures must enter a loaded chunk at least once before they can be registered through their anchors or arena systems.

---

## [1.5.1] — Nether Gauntlet Movement Correction

### Fixed

* Corrected the vertical reference used by Nether Gauntlet navigation.
* Prevented the boss from slowly rising after activation.
* Aligned movement with the player's combat height instead of the player's torso.
* Corrected attack-positioning calculations to use the boss's launch origin.
* Reduced excessive vertical wind-up movement.

### Changed

* Reduced the first attack delay from 80 to 50 ticks.
* Increased neutral movement response.
* Increased attack-preparation steering response.
* Improved locked-charge support without allowing mid-attack retargeting.
* Added altitude and target-anchor values to combat diagnostics.

### Technical

Behavior Pack animation timelines remain authoritative for attack milestones. This release changes navigation and Bedrock movement conversion only.

---

## [1.5.0] — Hybrid Combat Engine

### Added

* Added authoritative server-side combat timelines through Behavior Pack animations.
* Added a server animation controller for selecting active attack timelines.
* Added Script API timeline pulse handling.
* Added watchdog diagnostics for incomplete or stale attack timelines.

### Changed

Combat timing is no longer controlled entirely by JavaScript.

Behavior Pack animations and animation controllers now manage:

* Attack milestones.
* Hand and eye states.
* Physical collision changes.
* Casting windows.
* Projectile-release timing.
* Teleport stages.
* Attack completion.

JavaScript continues to manage:

* Target selection.
* Attack history.
* Navigation.
* Projectile simulation.
* Raycasts.
* Collision calculations.
* Damage.
* Explosions.
* Structures.
* Progression.
* Death sequences and rewards.

### Nether Gauntlet

* Migrated punch, swirl punch, laser, and darkness timelines to the hybrid engine.
* Synchronized open-hand and closed-fist collision states.
* Replaced most JavaScript tick comparisons with timeline milestones.
* Retained JavaScript-based OBB, swept collision, eye proxy, and laser raycasts.

### Night Lich

* Migrated comet, missile, phantom, teleport, and rage timelines to the hybrid engine.
* Synchronized physical actions with visual animation states.
* Preserved JavaScript-based teleport calculation, navigation, projectiles, progression, and death handling.

### Compatibility

* Minimum Minecraft Bedrock version: `1.26.30`.
* Script API dependency: `@minecraft/server` `2.9.0-beta`.
* Beta APIs experiment required.

---

## [1.4.1] — Combat Movement Corrections

### Night Lich

* Removed the active-combat home leash.
* Prevented the Night Lich from teleporting to its spawn point during valid combat.
* Added weak vertical correction only at excessive target separation.
* Fixed an `InvalidEntityError` caused by invalidated projectiles.

### Nether Gauntlet

* Prevented melee attacks from starting while moving away from the target.
* Reduced excessive wind-up lift.
* Added a small forward launch speed during preparation.
* Adjusted punch and swirl-punch launch ranges.
* Added locked charge-speed support.
* Prevented later attack impulses from reversing the original charge.
* Restored normal movement when the fist reopens.
* Increased roaming movement response.

---

## [1.4.0] — Nether Gauntlet Combat Rewrite

### Added

Replaced the previous shared movement controller with an explicit combat state machine:

* `dormant`
* `reposition`
* `prepare`
* `attack`

### Targeting

* Target switching now occurs only when selecting a new move.
* Damage from another player no longer redirects an attack already in progress.
* Preserved weighted move selection and four-move attack history.

### Movement

* Added upstream-style validated flight navigation.
* Added deterministic attack preparation.
* Added corridor validation before committed melee attacks.
* Added obstacle-aware repositioning.
* Reproduced Java-style travel drag.

### Punches

* Removed continuous guided-charge correction.
* Restored scheduled punch impulses.
* Locked the target position when each attack begins.
* Required a valid launch position and facing direction before commitment.
* Preserved swept collision, block impact, explosions, and velocity transfer.

### Cooldowns

* Removed additional synthetic recovery periods.
* Restored attack cooldowns based on the original action durations.

### Animation

* Rebuilt the Nether Gauntlet action controller.
* Set action transitions to zero blend time.
* Prevented movement decisions from replacing active attack animations.

---

## [1.3.0] — Night Lich Fidelity Rewrite

### API

* Updated `@minecraft/server` from `2.8.0` to `2.9.0-beta`.
* Added support for stopping active teleport-preparation sounds.
* Beta APIs became required.

### Damage behavior

* Removed artificial damage immunity during teleportation.
* Removed the reduced teleport hurtbox.
* Restored the normal damageable hitbox while visually disappearing.
* Matched the original boss's general vulnerability behavior.

### Animation

* Rebuilt the main action controller around the original Java animation mapping.
* Added zero-blend transitions between action states.
* Added direct transitions between interrupted attacks, teleportation, and rage states.
* Preserved original action lengths and milestone timing.

### Teleportation

* Teleport destinations are now selected and locked at the start of the action.
* Improved spawn-space and line-of-sight validation.
* Removed incorrect candidate-to-player raycasts.
* Expanded fallback surface scanning.
* Improved disappearance and reappearance particles.
* Allowed movement during teleport preparation.

### Movement and targeting

* Added an upstream-style Night Lich flight controller.
* Preserved previous movement direction when possible.
* Added randomized validated direction selection.
* Removed the arbitrary minimum-damage activation threshold.
* Expanded comparison diagnostics.

---

## [1.2.9] — Nether Gauntlet Activation Fix

### Changed

* Removed the synthetic closed-fist spawn presentation.
* Restored the original open-hand dormant pose.
* The boss remains stationary and protected until its eye is damaged.
* The first valid eye hit now activates the boss without forcing an attack.
* The first attack begins after the intended activation delay.
* Later damage no longer shortens the active attack timer.

### Fixed

* Added target validation before committing an attack.
* Failed attack commitments now return to idle and retry safely.
* Prevented invalid targets from causing false punch animations.

---

## [1.2.8] — Punch and Eye Reliability

### Fixed

* Prevented missed punches from carrying the Nether Gauntlet across the entire arena.
* Stopped charge support after crossing the locked target plane.
* Added velocity damping after missed attacks.
* Moved the eye proxy farther in front of the broad physical collision.
* Removed unsupported projectile-damage reapplication.

### Changed

* Extended the stable open-eye recovery period.
* Extended the temporary spawn presentation used in this version.

### Unchanged

* Night Lich behavior was not modified.

---

## [1.2.7] — Eye Accessibility

### Added

* Added a temporary closed-fist spawn presentation.
* Added stable open-eye recovery after attacks.
* Added authoritative eye-proxy projectile handling.
* Added eye-hit combat telemetry.

### Fixed

* Replaced overlapping body-part proxy entities with a single eye proxy.
* Prevented broad physical collision from intercepting arrows aimed at the eye.
* Improved swept projectile testing against the eye.
* Corrected projectile damage attribution.
* Added a safe fallback when Bedrock invalidates a projectile before deferred damage.

### Changed

* Reduced open-eye retreat distance and movement response.
* Preserved closed-fist attack movement behavior.

---

## [1.2.6] — Death Rewards and Movement Stability

### Fixed

* Replaced unsafe access to invalidated dead entities with captured death snapshots.
* Added multiple deduplicated death-sequence triggers.
* Restored Nether Gauntlet death effects, reward chest, and 1,000 experience reward.
* Added safer Soul Star reward fallback behavior.

### Movement

* Restricted environmental movement suppression to active charge windows.
* Restored movement during preparation and recovery.
* Reduced excessive vertical preparation velocity.
* Expanded movement telemetry.

---

## [1.2.5] — Compatibility and Combat Fidelity

### Fixed

* Added dynamic detection for experience-spawning support.
* Added persistent fallback experience rewards.
* Corrected open-hand and closed-fist oriented bounding boxes.
* Locked punch direction and target position at attack start.
* Restored scheduled punch acceleration milestones.
* Added per-player impact cooldowns.

### Diagnostics

* Added aggregated combat metrics for:

  * Speed.
  * Range.
  * Vertical movement.
  * Direction changes.
  * Immobility.
  * Collision blocking.
  * Return time.

### Compatibility

* Minecraft Bedrock `1.26.33`.
* `@minecraft/server` `2.8.0`.

---

## Earlier development builds

Versions before `1.2.5` were internal or early development builds and are not fully documented in this consolidated changelog
