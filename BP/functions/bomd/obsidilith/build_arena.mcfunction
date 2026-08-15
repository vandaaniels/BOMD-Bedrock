# Places the original 33 x 47 x 33 Obsidilith arena centered on the executor.
# The executor's current Y is used as the arena base; the summoning frame is 46 blocks above it.
structure load bomd:obsidilith_arena ~-16 ~ ~-16
tellraw @s {"rawtext":[{"text":"§5[BOMD] §fOriginal Obsidilith arena placed. The summoning frame is 46 blocks above this command position."}]}
