# Ejecutar únicamente en un área vacía: reemplaza un volumen de 29 x 29 bloques.
fill ~-14 ~-1 ~-14 ~14 ~-1 ~14 deepslate_tiles
fill ~-14 ~ ~-14 ~14 ~4 ~-14 packed_ice
fill ~-14 ~ ~14 ~14 ~4 ~14 packed_ice
fill ~-14 ~ ~-13 ~-14 ~4 ~13 packed_ice
fill ~14 ~ ~-13 ~14 ~4 ~13 packed_ice
fill ~-13 ~ ~-13 ~13 ~5 ~13 air
fill ~-2 ~-1 ~-2 ~2 ~-1 ~2 crying_obsidian
setblock ~ ~-1 ~ respawn_anchor
tellraw @s {"rawtext":[{"translate":"bomd.function.lich.build_test_arena"}]}
