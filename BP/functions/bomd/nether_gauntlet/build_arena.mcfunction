# Carga la arena original de 47 x 26 x 47 centrada alrededor del ejecutor. Usa un área vacía del Nether.
structure load bomd:nether_gauntlet_arena ~-23 ~-3 ~-23
tellraw @s {"rawtext":[{"translate":"bomd.function.gauntlet.build_arena"}]}
