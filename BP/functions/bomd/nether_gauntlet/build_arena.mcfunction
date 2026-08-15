# Executor position = center of the original 47 x 26 x 47 arena.
structure load bomd:gauntlet_arena ~-23 ~ ~-23
playsound bomd.nether_gauntlet.cast @s ~ ~ ~ 2 0.72
tellraw @s {"rawtext":[{"text":"§4[BOMD] §fOriginal Nether Gauntlet arena built. Break one of the five central seals to release it."}]}
