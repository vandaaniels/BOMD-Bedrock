# Combat test protocol — 1.4.1

## Preparation

1. Remove the 1.4.0 Behavior Pack and Resource Pack from the world and storage.
2. Import the 1.4.1 `.mcaddon`.
3. Enable Beta APIs.
4. Enable the Content Log.
5. Run `/scriptevent bomd:debug record_start` before each test and `/scriptevent bomd:debug record_stop` afterward.

## Nether Gauntlet

Test at full health and below 70% health.

- Stand still for three normal punches. At least one stationary-target punch should cross the player during ticks 16-55 and emit `gauntlet_swept_hit`.
- During wind-up, the fist should rise visibly but should not climb five or more blocks above a player standing at the same floor height.
- Walk sideways after `gauntlet_attack_start`. The punch must remain dodgeable and must not curve toward the new player position.
- Inspect `gauntlet_attack_ready`: `forwardVelocity` should normally be at least 0.10, never negative unless the 60-tick fallback was used.
- After tick 56 for punch or tick 60 for swirl, the boss must resume flight rather than remain almost motionless until tick 80.
- Record at least 300 samples. Compare average speed with the 1.4.0 baseline of 0.144 blocks/tick.

## Night Lich

Test once with the tower and once with `/summon bomd:night_lich` in an open area.

- Fly or pillar upward so the Lich exceeds 24 blocks vertically from its spawn point while remaining within combat range.
- It must not snap back to the original spawn location.
- It should steer back toward the 15-30 block target range gradually.
- Trigger teleport attacks at several heights. A normal teleport must move to the selected target-relative destination, not to the stored home point.
- Fire or intercept comets and missiles. The Content Log must not show `read Night Lich projectile impact velocity failed`.
