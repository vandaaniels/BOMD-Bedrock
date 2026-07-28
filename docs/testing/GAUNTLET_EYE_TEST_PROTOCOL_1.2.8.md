# Nether Gauntlet eye and charge test — 1.2.8

1. Remove the previous 1.2.7 packs, import 1.2.8, and activate both packs.
2. Spawn the Gauntlet in an open test area while recording the Content Log.
3. Confirm it remains visually closed for about 45 ticks, then opens and remains dormant until a valid eye hit.
4. Fire arrows at the visible eye from 4, 10 and 20 blocks. Each valid proxy hit must reduce health without `UnsupportedFunctionalityError`, `proyectil no soportado`, or invalid projectile warnings.
5. At full health, record five normal punches. A missed charge must stop receiving forward thrust after crossing the fixed target point and must not traverse the whole arena.
6. After each punch, verify an exposed-eye window of roughly 2.8 seconds total: the final 16 attack ticks plus the 40-tick stable recovery.
7. During the 40-tick recovery, approach for a melee strike. The boss may face the player but must not retreat.
8. Shoot the palm outside the visible eye. The hit must be deflected and must not reduce boss health.
