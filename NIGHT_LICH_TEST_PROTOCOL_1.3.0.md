# Night Lich 1.3.0 test protocol

## World preparation

1. Remove the 1.2.9 behavior and resource packs from the world and storage.
2. Import the 1.3.0 `.mcaddon`.
3. Enable the **Beta APIs** experiment before activating the behavior pack.
4. Enable the Content Log.
5. Enter the world and run `/scriptevent bomd:status`.
6. The reply must identify scripts 1.3.0 and API 2.9.0-beta.

## Damageability

1. Spawn the Night Lich in Survival.
2. Strike it during idle, comet preparation, missile preparation and minion preparation.
3. Its health must decrease in every case.
4. Strike or shoot its last visible position during teleport. There must be no scripted invulnerability error or `deals_damage: no` rejection.
5. This test intentionally does not look for a special vulnerability window; Java has none.

## Animation controller

1. Record several attacks from the front and side.
2. Comet, missiles, minions and rage must begin without a visible blend from idle.
3. Each one-shot must return cleanly to idle after its source animation duration.
4. During teleport, the sequence must be `teleport` -> invisible `teleporting` -> `unteleport` -> `idle`.
5. There must be no one-frame idle pose between `teleporting` and `unteleport`.
6. Head tracking and the 30-degree body flight pose must remain active without overriding the arm attack animation.

## Locked teleport destination

1. Run `/scriptevent bomd:debug record_start`.
2. Wait for teleport to begin and immediately move at least 15 blocks sideways during the 40-tick charge.
3. The Lich should reappear 20–35 blocks from the position used when the attack started, not 20–35 blocks from the player's tick-40 position.
4. Stop with `/scriptevent bomd:debug record_stop`.
5. Inspect `[BOMD_COMPARE]` for `lich_teleport_destination` followed later by `lich_teleport`; both entries must contain the same destination.

## Primary and fallback rule

1. In open space, look toward the Lich while it starts teleporting. The log should show `phase: "primary"` when valid space is found.
2. Repeat while facing away or with a solid wall between both entities. The log should show `primaryEligible: false` and use `phase: "heightmap_fallback"` when a fallback is found.
3. Candidate selection must not require line of sight from the future destination.

## Movement

1. Record at least 60 seconds with `/scriptevent bomd:debug record_start` and `record_stop`.
2. Verify that average distance remains broadly inside 15–30 blocks.
3. Check that direction changes are gradual and irregular rather than a stable circular orbit.
4. The boss must continue drifting during attack casting and teleport wind-up.
5. Report the `[BOMD_METRICS]` line and any warnings if movement becomes stagnant or excessively fast.
