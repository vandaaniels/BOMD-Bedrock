// @ts-check

export const BOSS_TYPE = "bomd:night_lich";
export const MAGIC_MISSILE_TYPE = "bomd:night_lich_magic_missile";
export const COMET_TYPE = "bomd:night_lich_comet";
export const LICH_PHANTOM_TYPE = "bomd:lich_phantom";
export const ANCHOR_TYPE = "bomd:night_lich_anchor";
export const SOUL_STAR_WISP_TYPE = "bomd:soul_star_wisp";
export const SOUL_STAR_ITEM = "bomd:soul_star";
export const ANCIENT_ANIMA_ITEM = "bomd:ancient_anima";
export const ALTAR_BLOCK = "bomd:chiseled_stone_altar";
export const ALTAR_LIT_STATE = "bomd:lit";
export const FROST_PARTICLE = "bomd:frost_spark";
export const TELEPORT_PARTICLE = "bomd:teleport_swirl";
export const SOUL_FLAME_PARTICLE = "bomd:soul_flame";
export const MAGIC_CIRCLE_PARTICLE = "bomd:magic_circle";
export const SPARKLE_PARTICLE = "bomd:sparkles";
export const PHASE_RUNES_PARTICLE = "bomd:phase_runes";
export const MINION_TAG = "bomd:lich_minion";
export const TOWER_GUARD_TAG = "bomd:lich_tower_guard";
export const MAGIC_MISSILE_DAMAGE = 9;
// Java-exact profile: the comet uses the upstream explosion strength 4.
export const COMET_EXPLOSION_POWER = 4;

export const HOME_X_PROPERTY = "bomd:home_x";
export const HOME_Y_PROPERTY = "bomd:home_y";
export const HOME_Z_PROPERTY = "bomd:home_z";
export const PREVIOUS_ATTACK_PROPERTY = "bomd:previous_attack";
export const ATTACK_HISTORY_PROPERTY = "bomd:attack_history";
export const RAGE_QUEUE_PROPERTY = "bomd:rage_queue";
export const SOUL_KILLS_PROPERTY = "bomd:soul_kills";
export const TOWER_INITIALIZED_PROPERTY = "bomd:tower_initialized";
export const TOWER_ACTIVE_PROPERTY = "bomd:tower_active";
export const TOWER_DEFEATED_PROPERTY = "bomd:tower_defeated";
export const TOWER_LOOT_MASK_PROPERTY = "bomd:tower_loot_mask";
export const TOWER_GUARD_MASK_PROPERTY = "bomd:tower_guard_mask";
export const TOWER_ROTATION_PROPERTY = "bomd:tower_rotation";
export const TOWER_PENDING_EXPERIENCE_PROPERTY = "bomd:tower_pending_experience";

export const COMBAT_RADIUS = 64;
export const LEASH_RADIUS = 50;
export const SAFETY_RESET_DELAY_TICKS = 20 * 60 * 5;
export const LICH_DEATH_SEQUENCE_TICKS = 52;
export const LICH_EXPERIENCE = 1500;
export const LICH_EXPERIENCE_PULSES = 18;
export const MANAGER_INTERVAL_TICKS = 1;
export const SOUL_STAR_KILL_INTERVAL = 50;

export const ALTAR_OFFSETS = Object.freeze([
  Object.freeze({ x: -6, y: 0, z: 0 }),
  Object.freeze({ x: 0, y: 0, z: -6 }),
  Object.freeze({ x: 0, y: 0, z: 6 }),
  Object.freeze({ x: 6, y: 0, z: 0 })
]);

export const ANIMATION_STATE = Object.freeze({
  idle: 0,
  missiles: 1,
  comet: 2,
  minions: 3,
  teleport: 4,
  teleporting: 5,
  unteleport: 6,
  rage: 7
});

export const ANIMATION_TICKS = Object.freeze({
  comet: 76,
  missiles: 76,
  minions: 63,
  rage: 49,
  teleportVanish: 29,
  teleportMove: 40,
  teleportReturn: 61
});
