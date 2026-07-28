# Ejecutar en una arena vacía. Invoca y mata un Gauntlet para probar únicamente la recompensa.
summon bomd:nether_gauntlet ~ ~1 ~
kill @e[type=bomd:nether_gauntlet,r=4,c=1]
tellraw @s {"rawtext":[{"translate":"bomd.function.gauntlet.test_reward"}]}
