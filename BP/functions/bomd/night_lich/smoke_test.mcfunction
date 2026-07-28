# Prueba visible de registro para Bedrock 26.33.
give @s bomd:soul_star 4
give @s bomd:ancient_anima 2
give @s bomd:blazing_eye 1
give @s bomd:levitation_block 1
setblock ~2 ~ ~ bomd:chiseled_stone_altar
summon bomd:night_lich ~ ~4 ~
tellraw @s {"rawtext":[{"translate":"bomd.function.lich.smoke.1"}]}
tellraw @s {"rawtext":[{"translate":"bomd.function.lich.smoke.2"}]}
tellraw @s {"rawtext":[{"translate":"bomd.function.lich.smoke.3"}]}
