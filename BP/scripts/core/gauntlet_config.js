// @ts-check

export const GAUNTLET_TYPE = "bomd:nether_gauntlet";

export const GAUNTLET_SPARK_PARTICLE = "bomd:gauntlet_spark";
export const GAUNTLET_SMOKE_PARTICLE = "bomd:gauntlet_smoke";
export const GAUNTLET_BLOCK_DEBRIS_PARTICLE = "bomd:gauntlet_blackstone_debris";
export const GAUNTLET_LASER_PARTICLE = "bomd:gauntlet_laser";
export const GAUNTLET_TELEGRAPH_PARTICLE = "bomd:gauntlet_laser_telegraph";

export const GAUNTLET_COMBAT_RADIUS = 64;
export const GAUNTLET_LEASH_RADIUS = 44;
export const GAUNTLET_RESET_DELAY_TICKS = 240;
export const GAUNTLET_MANAGER_INTERVAL_TICKS = 1;
// Multipart OBB validation reconstructs the original Java eye, palm, finger,
// thumb and pinky boxes. Only a small network/tick margin is permitted.
export const GAUNTLET_OBB_MARGIN = 0.09;
export const GAUNTLET_MELEE_RAY_LENGTH = 5.5;
export const GAUNTLET_DORMANT_ARMOR = 24;
export const GAUNTLET_COMBAT_ARMOR = 8;
export const GAUNTLET_ENERGIZED_EXPLOSION_POWER = 4.5;
export const GAUNTLET_NORMAL_PUNCH_EXPLOSION_MULTIPLIER = 1.5;
export const GAUNTLET_EYE_OPEN_PROPERTY = "bomd:eye_open";

// Mirrors the original GeckoLib clips rather than combining attacks into synthetic animations.
export const GAUNTLET_ANIMATION_STATE = Object.freeze({
  idle: 0,
  punchStart: 1,
  punchLoop: 2,
  punchStop: 3,
  swirlPunch: 4,
  laserStart: 5,
  laserLoop: 6,
  laserStop: 7,
  cast: 8,
  death: 9
});

export const GAUNTLET_VISUAL_STATE = Object.freeze({
  normal: 0,
  charging: 1,
  overcharged: 2
});

// Original action cooldowns/timelines from BOMD 1.10.2.
export const GAUNTLET_ATTACK_TICKS = Object.freeze({
  punch: 80,
  swirlPunch: 80,
  blindness: 80,
  laser: 120
});

// Java base attack is 16; laser temporarily applies -25% base attack = 12.
export const GAUNTLET_DAMAGE = Object.freeze({
  punch: 16,
  swirlPunch: 16,
  laser: 12
});

export const GAUNTLET_LASER_UNLOCK = 0.85;
export const GAUNTLET_SWIRL_UNLOCK = 0.70;
export const GAUNTLET_BLINDNESS_UNLOCK = 0.50;
export const GAUNTLET_LASER_LAG_TICKS = 8;
// Vanilla Java damage immunity allows a new full melee hit after roughly 10 ticks.
export const GAUNTLET_HURT_COOLDOWN_TICKS = 10;
// Java adds +0.7 Y once, but Bedrock custom no-gravity entities retain a
// materially larger vertical displacement even after explicit 0.85 drag. The
// Earlier Bedrock tests showed that the literal Java impulse produced excessive
// vertical travel on a no-gravity custom entity. Version 1.5.4 reduces the
// conversion again so the wind-up remains visible without lifting the fist over
// the target.
export const GAUNTLET_WINDUP_UPWARD_SPEED = 0.22;

// Java starts with the normal idle/open-hand state. Aggro begins only after a
// successful eye hit. A short acquisition delay prevents a cancelled-punch
// visual while keeping the encounter responsive.
export const GAUNTLET_INITIAL_ATTACK_DELAY_TICKS = 50;
// Combat rewrite: a move is selected once, then the boss commits to positioning
// and executing it. These are preparation limits, not additional cooldowns.
export const GAUNTLET_ATTACK_PREPARE_TIMEOUT_TICKS = 60;
// Launch farther than the 1.4.0 6-9 block band. The Java wind-up adds +0.7 Y
// for sixteen or thirty ticks; at very short horizontal range most of the
// first charge impulse was spent descending instead of crossing the player.
export const GAUNTLET_PUNCH_LAUNCH_MIN_RANGE = 7;
export const GAUNTLET_PUNCH_LAUNCH_MAX_RANGE = 11;
export const GAUNTLET_SWIRL_LAUNCH_MIN_RANGE = 7;
export const GAUNTLET_SWIRL_LAUNCH_MAX_RANGE = 10.5;
export const GAUNTLET_TRAVEL_DRAG = 0.85;

// Bedrock conversion values. Java runs the movement goal concurrently with
// PunchAction; 1.4.0 disabled that support and also braked the boss to almost
// zero before committing, which made the exact 0.60/0.32 impulses arrive too
// late. These values preserve a locked, dodgeable trajectory while replacing
// the missing background steering. They never retarget a moving player.
export const GAUNTLET_LAUNCH_FORWARD_SPEED = 0.32;
export const GAUNTLET_CHARGE_WINDUP_SPEED = 0.34;
export const GAUNTLET_CHARGE_ACTIVE_SPEED = 0.62;
export const GAUNTLET_CHARGE_SUPPORT_RESPONSE = 0.30;
export const GAUNTLET_CHARGE_SUPPORT_MAX_IMPULSE = 0.11;

// VelocitySteering mass 120 is retained by the Java source, but Bedrock also
// resolves custom-entity impulses after its own movement step. A lower
// conversion mass produces the same visible traversal rate instead of the
// low traversal speed measured in earlier Bedrock captures.
export const GAUNTLET_BEDROCK_STEERING_MASS = 40;

// The movement solver steers the entity origin, while the visible eye sits
// roughly 1.6 blocks above it. Targeting the player torso with the entity
// origin caused a slow climb after aggro. Keep the origin below the player's
// torso so the eye and fist remain at combat height.
export const GAUNTLET_TARGET_ORIGIN_Y_OFFSET = -0.70;
export const GAUNTLET_VERTICAL_TOLERANCE = 1.15;
export const GAUNTLET_VERTICAL_CORRECTION_STRENGTH = 0.72;

export const GAUNTLET_HOME_X_PROPERTY = "bomd:gauntlet_home_x";
export const GAUNTLET_HOME_Y_PROPERTY = "bomd:gauntlet_home_y";
export const GAUNTLET_HOME_Z_PROPERTY = "bomd:gauntlet_home_z";
