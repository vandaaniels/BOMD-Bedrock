# BOMD Bedrock

An unofficial **Minecraft Bedrock Edition port of Bosses of Mass Destruction**, focused on recreating the bosses, progression, structures, items, attacks, animations, and visual effects of the original Java mod as faithfully as Bedrock allows.

> **Current version:** 2.1.28
> **Minecraft Bedrock:** 1.26.40+
> **Script API:** `@minecraft/server 2.9.0`

## Bosses

The current build includes all four main Bosses of Mass Destruction bosses:

* **Night Lich**
* **Nether Gauntlet**
* **Void Blossom**
* **Obsidilith**

Each boss has its own combat mechanics, attacks, arena or structure, visual effects, animations, progression systems, and rewards adapted for Minecraft Bedrock.

## Features

* Four major boss encounters
* Boss-specific combat AI and attack systems
* Custom boss bars and UI elements
* Survival-oriented progression
* Naturally accessible boss structures and arenas
* Custom structures for each encounter
* Boss-specific projectiles and entities
* Original-inspired animations and visual effects
* Custom particles and sound effects
* PBR / Vibrant Visuals support
* English and Spanish localization
* Multiplayer-compatible systems
* Custom blocks, items, weapons, and rewards

## Items

The port currently includes several items and rewards inspired by the original mod, including:

* Soul Star
* Earthdive Spear
* Charged Ender Pearl
* Ancient Anima
* Obsidian Heart
* Void Thorn
* Crystal Fruit
* Brimstone Nectar
* Blazing Eye

Additional blocks and progression-related content are also included.

## Installation

1. Download the latest `.mcaddon` release.
2. Open the file with Minecraft Bedrock Edition.
3. Minecraft should automatically import both the **Behavior Pack** and **Resource Pack**.
4. Create a new world or edit an existing one.
5. Activate both BOMD packs.
6. Enable any experimental features required by your Minecraft version if prompted.

Using both the Behavior Pack and Resource Pack is required.

## Compatibility

BOMD Bedrock 2.1.28 currently targets:

* **Minecraft Bedrock 1.26.40 or newer**
* **@minecraft/server 2.9.0**

Older Minecraft versions are not supported.

## Development Status

BOMD Bedrock is still under active development.

Although the addon is playable, some mechanics may continue to receive changes as the Bedrock implementation is brought closer to the original Java experience.

You may encounter:

* Bugs
* Balance issues
* Visual inconsistencies
* Performance issues on some devices
* Differences caused by Bedrock Edition engine limitations

Bug fixes, combat improvements, optimization, and fidelity improvements will continue in future releases.

## Reporting Bugs

Please report problems through the repository's **Issues** section.

When reporting a bug, include as much of the following information as possible:

* Minecraft Bedrock version
* BOMD Bedrock version
* Platform or device
* Boss, item, block, or system affected
* Steps required to reproduce the problem
* Screenshots or videos when useful
* Relevant Content Log errors

Detailed reports make problems considerably easier to reproduce and fix.

## Credits

**BOMD Bedrock** is an unofficial Bedrock Edition port.

* Bedrock port developed by **Rossetti**
* **Bosses of Mass Destruction** and its original assets by **Barribob** and the original project contributors

Original assets are used with authorization where applicable.

This project is not affiliated with or endorsed by Mojang Studios or Microsoft.

## License

See the repository's [`LICENSE`](LICENSE) and [`NOTICE.md`](NOTICE.md) files for licensing, attribution, and asset usage information.

## Repository Structure

```text
BOMD-Bedrock/
├── BP/       # Behavior Pack
├── RP/       # Resource Pack
├── docs/     # Documentation
├── patches/  # Project patches
└── ...
```

## Disclaimer

Minecraft is a trademark of Microsoft Corporation.

This is a community-made project and is not an official Minecraft, Mojang Studios, Microsoft, or Bosses of Mass Destruction release.
