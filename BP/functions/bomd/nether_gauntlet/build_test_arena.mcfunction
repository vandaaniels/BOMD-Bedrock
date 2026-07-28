# Ejecutar únicamente en un área vacía: reemplaza un volumen de 33 x 9 x 33.
fill ~-16 ~-1 ~-16 ~16 ~-1 ~16 polished_blackstone_bricks
fill ~-16 ~ ~-16 ~16 ~8 ~16 air
fill ~-16 ~ ~-16 ~16 ~5 ~-16 blackstone
fill ~-16 ~ ~16 ~16 ~5 ~16 blackstone
fill ~-16 ~ ~-15 ~-16 ~5 ~15 blackstone
fill ~16 ~ ~-15 ~16 ~5 ~15 blackstone
fill ~-2 ~-1 ~-2 ~2 ~-1 ~2 crying_obsidian
tellraw @s {"rawtext":[{"translate":"bomd.function.gauntlet.build_test_arena"}]}
