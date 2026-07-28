# BOMD structure locator — 1.5.4

Native Creative/operator command:

```mcfunction
/bomd:find_structure <night_lich|nether_gauntlet> [coords|tp]
```

Examples:

```mcfunction
/bomd:find_structure night_lich coords
/bomd:find_structure night_lich tp
/bomd:find_structure nether_gauntlet coords
/bomd:find_structure nether_gauntlet tp
```

The command was renamed because the short alias generated from `bomd:locate` conflicts with Minecraft's vanilla `/locate`.

Compatibility fallbacks remain available:

```mcfunction
/scriptevent bomd:locate night_lich coords
/scriptevent bomd:locate nether_gauntlet tp
/function bomd/locate/night_lich
/function bomd/locate/night_lich_tp
```
