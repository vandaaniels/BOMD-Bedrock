# Nether Gauntlet spawn and aggro test — 1.2.9

1. Remove 1.2.8 from the world and storage, then import and enable 1.2.9.
2. Spawn the Nether Gauntlet while looking directly at it.
3. From the first visible frame it must use the open-hand idle pose; it must not begin in `punch_loop`.
4. Wait at least five seconds without damaging it. It must remain still, open and idle.
5. Hit the eye once in Survival. The boss may acquire and face the player, but it must not immediately flash a punch animation.
6. During the next 80 ticks (four seconds), it should begin normal pursuit while remaining in idle.
7. At the end of that delay it may choose its first attack. Once `punch_start` begins, it must continue into `punch_loop`, the charge and `punch_stop` without returning to idle early unless the target becomes invalid.
8. Hit the eye repeatedly during the wake-up delay. These hits must not shorten the first-attack timer.
9. Repeat once in Creative. Creative players are not valid combat targets; hitting must not produce a punch-animation flash.
