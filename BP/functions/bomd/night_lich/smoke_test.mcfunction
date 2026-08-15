# Visible registration test for Bedrock 26.33.
give @s bomd:soul_star 1
give @s bomd:ancient_anima 1
setblock ~2 ~ ~ bomd:chiseled_stone_altar
summon bomd:night_lich ~ ~4 ~
tellraw @s {"rawtext":[{"text":"§b[BOMD] §fTest created: inspect both icons, the altar two blocks away, and the Night Lich animations."}]}
tellraw @s {"rawtext":[{"text":"§eImportant: §fthe bosses target Survival players only and ignore Creative, Adventure, and Spectator players."}]}
tellraw @s {"rawtext":[{"text":"§dVisual test: §fconfirm the eye, crown, and staff glow. The Night Lich bar should be blue with cyan nodes that turn off at 75, 50, and 25 percent health."}]}
