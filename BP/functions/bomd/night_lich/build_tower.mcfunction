# Run only in an empty area. Replaces 30 x 79 x 30 blocks around the executor.
kill @e[family=bomd_night_lich_anchor,r=8]
structure load bomd:night_lich_tower ~-16 ~-23 ~-14
summon bomd:night_lich_anchor ~0.5 ~0.5 ~0.5
tellraw @s {"rawtext":[{"text":"§b[BOMD] §fOriginal Night Lich tower built. Its chests and guardians will initialize shortly."}]}
tellraw @s {"rawtext":[{"text":"§7Obtain four Soul Stars, one per 50 valid kills, or use /function bomd/night_lich/give_soul_stars to test the ritual."}]}
