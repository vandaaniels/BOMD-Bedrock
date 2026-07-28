# Nether Gauntlet movement test — 1.5.1

1. Remove the previous packs, import 1.5.1, enable Beta APIs, and create a fresh Gauntlet.
2. Stand on level ground in Survival and hit the open eye once.
3. Observe the next 50 ticks. The entity base should remain near player Y - 0.70; it must not climb several blocks before selecting an attack.
4. Record movement with `/scriptevent bomd:debug record_start`, remain mostly still for at least four melee attacks, then use `/scriptevent bomd:debug record_stop`.
5. Inspect `altitudeError`. Normal roaming should usually remain within about ±1.15 blocks of the anchor. Short deviations during wind-up are valid.
6. Verify `gauntlet_attack_ready` has positive forward velocity and that stationary-player tests produce `gauntlet_swept_hit`.
7. Move sideways after a punch commits. The charge should remain dodgeable and must not recalculate its locked destination.
8. Check the Content Log for `timeline_watchdog`, stale timeline pulses, JSON errors, or script exceptions.
