# Original Java depth: Overworld minimum (-64) through -32.
scriptevent bomd:decorate_void_cavern
structure load bomd:void_blossom_cavern ~-32 -64 ~-32
summon bomd:void_blossom_anchor ~ -59 ~
summon bomd:void_blossom ~ -59 ~
playsound bomd.void_blossom.wave_indicator @s ~ -59 ~ 2 0.7
tellraw @s {"rawtext":[{"text":"§5[BOMD] §fA 65 x 33 x 65 cavern was built from Y -64 to Y -32. The Void Blossom spawned at its center."}]}
