# Contributing to BOMD Bedrock

Thank you for your interest in contributing to **Bosses of Mass Destruction: Bedrock Edition**.

This project is currently maintained primarily by **Rossetti** and is still in public beta. Contributions are welcome, but changes must preserve technical stability, compatibility between the Behavior Pack and Resource Pack, and fidelity to the original mod.

## Ways to contribute

You can help by:

* Reporting reproducible bugs.
* Testing bosses on different devices and Minecraft versions.
* Providing Content Log errors and performance information.
* Improving documentation or translations.
* Fixing scripts, behaviors, animations, or configuration errors.
* Suggesting technical improvements.
* Submitting focused pull requests.

## Before contributing

Before opening an issue or pull request:

1. Use the latest public beta or the latest source from the `main` branch.
2. Remove older installed versions of the Behavior Pack and Resource Pack.
3. Test the problem in a new world when possible.
4. Confirm that the required experimental features are enabled.
5. Check whether the issue or suggestion already exists.
6. Make sure your contribution does not include unauthorized third-party content.

## Reporting bugs

Open a GitHub Issue and include:

* Minecraft Bedrock version.
* Add-on version or commit.
* Platform and device.
* World type and dimension.
* Boss, item, structure, or system affected.
* Steps required to reproduce the issue.
* Expected behavior.
* Actual behavior.
* Relevant Content Log errors or warnings.
* Screenshots or short recordings when available.

Reports without reproduction steps may be difficult to investigate.

## Feature requests

Feature requests should explain:

* What should be added or changed.
* Why it would improve the project.
* Whether it exists in the original Java mod.
* How it could work within Bedrock limitations.
* Possible performance or compatibility risks.

Requests are not guaranteed to be accepted or implemented.

## Development setup

The repository contains:

```text
BP/
RP/
```

For local development, place them in the corresponding Minecraft development directories:

```text
development_behavior_packs/
development_resource_packs/
```

Both packs must remain compatible with each other.

The project currently uses:

```json
{
  "module_name": "@minecraft/server",
  "version": "2.9.0-beta"
}
```

Enable the required beta API experiment before testing.

## Branches

Do not work directly on `main`.

Create a separate branch using a descriptive name:

```text
fix/gauntlet-altitude
fix/lich-projectiles
feat/new-structure-system
docs/update-installation
```

Keep each branch focused on one change.

## Commit messages

Use clear and specific commit messages.

Recommended examples:

```text
fix(gauntlet): prevent altitude drift during pursuit
fix(lich): correct vulnerable phase transition
feat(locator): add persistent structure recovery
docs: clarify beta API requirements
refactor(combat): simplify projectile collision checks
```

Avoid unclear messages such as:

```text
update
changes
fix stuff
new files
```

## Pull requests

A pull request should:

* Address one clear problem or feature.
* Explain what changed.
* Explain why the change was necessary.
* Include testing steps.
* Mention affected bosses or systems.
* Include screenshots, logs, or recordings when useful.
* Avoid unrelated formatting or file changes.
* Preserve existing attribution and license notices.

Large changes should be discussed in an Issue before implementation.

## Code guidelines

When modifying scripts:

* Keep code readable and documented where necessary.
* Avoid unnecessary per-tick operations.
* Validate entities before accessing them.
* Handle unloaded dimensions and invalid references safely.
* Avoid duplicating combat timers between JavaScript and animation timelines.
* Keep server-authoritative combat logic synchronized with visual states.
* Preserve multiplayer compatibility where possible.
* Do not silently ignore errors that should be logged during development.

When modifying JSON:

* Validate syntax before submitting.
* Preserve namespaces and identifiers.
* Keep Behavior Pack and Resource Pack definitions synchronized.
* Avoid changing UUIDs unless absolutely necessary.
* Do not increase the minimum Minecraft version without documenting it.

## Boss behavior changes

Boss combat systems depend on synchronization between:

* Behavior Pack animations.
* Animation controllers.
* Entity events.
* Script API state.
* Damage and collision systems.
* Visual properties and render controllers.

Changes to attack timing, phases, movement, animations, or collision must be tested as a complete sequence.

At minimum, test:

* Boss spawning and activation.
* Target acquisition.
* Every attack.
* Phase transitions.
* Player death and respawn.
* Boss death and rewards.
* Saving and reopening the world.
* Content Log output.

## Structures and world generation

Changes to structures or generation should be tested with:

* Multiple world seeds.
* Different terrain heights.
* Nearby liquids and irregular terrain.
* Chunk unloading and reloading.
* Previously generated worlds.
* Duplicate-generation prevention.
* Structure locator systems.

World generation changes must not assume that every surface is flat or fully loaded.

## Assets and third-party content

Do not submit:

* Assets copied from unrelated projects.
* Content without permission or a compatible license.
* Decompiled Marketplace content.
* Paid or private resources.
* AI-generated assets without clear disclosure and usage rights.
* Files that violate Mojang or Microsoft distribution rules.

All contributed assets must include their origin, author, and license when applicable.

## Translations

Translation contributions should:

* Preserve localization keys.
* Use UTF-8 encoding without invalid or null characters.
* Keep formatting codes and placeholders unchanged.
* Avoid machine translation without manual review.
* Match the terminology used by the original mod when possible.

## Performance

Minecraft Bedrock runs on devices with widely different capabilities.

Contributions should avoid:

* Large unrestricted entity scans.
* Heavy calculations every tick.
* Repeated command execution where Script API alternatives exist.
* Excessive particles, projectiles, or temporary entities.
* Permanent references to invalid or unloaded entities.
* Unbounded arrays, histories, or registries.

Performance-sensitive changes should include testing information.

## License

By submitting a contribution, you agree that it may be distributed under the license applicable to the files or components you modify.

This repository contains material under multiple licenses. Review:

* [`LICENSE-SCOPE.md`](LICENSE-SCOPE.md)
* [`NOTICE.md`](NOTICE.md)
* [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md)

Do not remove copyright, attribution, or license notices.

Submitting a contribution does not transfer ownership of unrelated original or third-party material.

## Code of conduct

Contributors must communicate respectfully and keep technical discussions focused on the project.

Harassment, insults, threats, spam, plagiarism, or deliberate distribution of unauthorized content will not be accepted.

## Maintainer decisions

All contributions are reviewed at the maintainer’s discretion.

A contribution may be declined because of:

* Technical instability.
* Performance concerns.
* Incompatibility with the project architecture.
* Lack of testing.
* Insufficient attribution.
* Licensing concerns.
* Excessive scope.
* Departure from the intended design of the original mod.

Acceptance of one contribution does not guarantee acceptance of similar future changes.
