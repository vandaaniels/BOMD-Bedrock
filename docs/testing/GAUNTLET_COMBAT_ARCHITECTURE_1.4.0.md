# Nether Gauntlet combat architecture — 1.4.0

## Design rule

Movement may help the boss reach a valid attack position, but it may not choose, replace, redirect, or cancel a committed action. Only target invalidation, boss death, or timeline completion can end an action.

## State transitions

```text
dormant
  └─ valid eye damage → reposition (80 tick initial cooldown)

reposition
  ├─ cooldown active → Java-style validated flight
  └─ cooldown expires → choose target + choose one move → prepare

prepare
  ├─ laser / blindness → attack immediately
  ├─ punch / swirl → direct launch positioning
  ├─ blocked corridor → strafe without rerolling
  └─ valid range + clear corridor + facing → attack

attack
  ├─ action-specific fixed timeline
  ├─ invalid target → reposition
  └─ action cooldown completes → reposition
```

## Why this differs from a literal scheduler port

Java runs movement and attacks as a `CompositeGoal`. Bedrock custom-entity impulses and drag do not produce the same result when two independent script systems modify velocity every tick. The rewrite preserves Java's move selection, timings, acceleration events, drag, hit logic, and target memory while serializing ownership of the movement vector during melee actions.

## Attack ownership

- During preparation, a clear launch band uses braking and facing alignment rather than an orbit vector, preventing visible hesitation before the attack.
- Normal punch and swirl punch own movement for their entire 80-tick action.
- Laser and blindness retain neutral movement while casting, as they do not use charge movement.
- A new move cannot be selected while `pendingAttackId` or `currentAttack` is set.
- A hit from another player is recorded for the next target-switch decision but does not redirect the current action.
