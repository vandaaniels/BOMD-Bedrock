# Nether Gauntlet eye test protocol — 1.2.7

1. Spawn the Gauntlet and do not attack it. It should appear as a closed fist for about 1.5 seconds, then open and remain stationary.
2. In Survival, fire an unenchanted bow at the center of the visible eye from 4, 10 and 20 blocks. Each accurate shot should reduce health and must not print `UnsupportedFunctionalityError` or a projectile-not-supported error.
3. Fire at the palm and fingers. Those hits must be cancelled and produce the deflection feedback.
4. Awaken the boss and observe five normal punches. From tick 64 until the attack ends, and for one second afterward, the open eye should be stable rather than rapidly retreating.
5. Approach while the eye is open. The boss may maintain distance, but should not reverse faster than normal player movement at close range.
6. With combat recording enabled, accepted proxy shots should produce `gauntlet_eye_proxy_hit`.
