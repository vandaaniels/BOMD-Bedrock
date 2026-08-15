// @ts-check

export const BOSS_TYPE = "bomd:night_lich";
export const MAGIC_MISSILE_TYPE = "bomd:night_lich_magic_missile";
export const COMET_TYPE = "bomd:night_lich_comet";
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
export const LICH_PHANTOM_TYPE = "bomd:lich_phantom";
export const TOWER_GUARD_TAG = "bomd:lich_tower_guard";
export const MAGIC_MISSILE_DAMAGE = 9;
export const COMET_EXPLOSION_POWER = 4;
export const COMET_BALANCED_POWER = 2.5;

export const GAUNTLET_TYPE = "bomd:nether_gauntlet";
export const GAUNTLET_SEAL_BLOCK = "bomd:gauntlet_blackstone";
export const BLAZING_EYE_ITEM = "bomd:blazing_eye";
export const GAUNTLET_ENERGY_PARTICLE = "bomd:gauntlet_energy";
export const GAUNTLET_IMPACT_PARTICLE = "bomd:gauntlet_impact";
export const GAUNTLET_WAVE_PARTICLE = "bomd:gauntlet_wave";
export const GAUNTLET_LASER_TELEGRAPH_PARTICLE =
  "bomd:gauntlet_laser_telegraph";
export const GAUNTLET_LASER_PARTICLE = "bomd:gauntlet_laser";
export const GAUNTLET_LASER_BEAM_TYPE = "bomd:gauntlet_laser_beam";
export const GAUNTLET_NORMAL_PUNCH_DAMAGE = 16;
export const GAUNTLET_LASER_DAMAGE = 12;
export const GAUNTLET_SPIN_DAMAGE = 16;
export const GAUNTLET_COMBAT_RADIUS = 48;
export const GAUNTLET_LEASH_RADIUS = 45;
export const GAUNTLET_RESET_DELAY_TICKS = 200;
export const GAUNTLET_IDLE_HEAL_PER_TICK = 0.5;
export const GAUNTLET_AWAKE_PROPERTY = "bomd:gauntlet_awake";
export const GAUNTLET_EYE_OPEN_PROPERTY = "bomd:gauntlet_eye_open";
export const GAUNTLET_HAND_CLOSED_PROPERTY =
  "bomd:gauntlet_hand_closed";
export const GAUNTLET_HOME_X_PROPERTY = "bomd:gauntlet_home_x";
export const GAUNTLET_HOME_Y_PROPERTY = "bomd:gauntlet_home_y";
export const GAUNTLET_HOME_Z_PROPERTY = "bomd:gauntlet_home_z";
export const GAUNTLET_PREVIOUS_ATTACK_PROPERTY =
  "bomd:gauntlet_previous_attack";
export const GAUNTLET_ATTACK_HISTORY_PROPERTY =
  "bomd:gauntlet_attack_history";
export const GAUNTLET_SCALED_PLAYERS_PROPERTY =
  "bomd:gauntlet_scaled_players";
export const GAUNTLET_BALANCE_VERSION_PROPERTY =
  "bomd:gauntlet_balance_version";
export const GAUNTLET_DYING_PROPERTY = "bomd:gauntlet_dying";
export const GAUNTLET_DEATH_END_TICK_PROPERTY =
  "bomd:gauntlet_death_end_tick";
export const GAUNTLET_DEATH_TICKS = 50;
export const GAUNTLET_EYE_HIT_RADIUS = 1.05;
export const GAUNTLET_ENERGIZED_EXPLOSION_POWER = 4.5;
export const GAUNTLET_NORMAL_EXPLOSION_MULTIPLIER = 1.5;
export const GAUNTLET_SEALED_BLOCK = "bomd:sealed_blackstone";

export const TOWER_SEED_BLOCK = "bomd:night_lich_tower_seed";
export const TOWER_SEED_STRUCTURE = "bomd:night_lich_tower_seed";
export const TOWER_LOCATOR_SEED_PROPERTY = "bomd:tower_locator_seed";
export const TOWER_PLANNED_PROPERTY = "bomd:tower_planned_locations";
export const TOWER_DEFEATED_LOCATIONS_PROPERTY =
  "bomd:tower_defeated_locations";

export const HOME_X_PROPERTY = "bomd:home_x";
export const HOME_Y_PROPERTY = "bomd:home_y";
export const HOME_Z_PROPERTY = "bomd:home_z";
export const SCALED_PLAYERS_PROPERTY = "bomd:scaled_players";
export const PREVIOUS_ATTACK_PROPERTY = "bomd:previous_attack";
export const ATTACK_HISTORY_PROPERTY = "bomd:attack_history";
export const RAGE_QUEUE_PROPERTY = "bomd:rage_queue";
export const BALANCE_VERSION_PROPERTY = "bomd:balance_version";
export const SOUL_KILLS_PROPERTY = "bomd:soul_kills";
export const TOWER_INITIALIZED_PROPERTY = "bomd:tower_initialized";
export const TOWER_ACTIVE_PROPERTY = "bomd:tower_active";
export const TOWER_DEFEATED_PROPERTY = "bomd:tower_defeated";
export const TOWER_LOOT_MASK_PROPERTY = "bomd:tower_loot_mask";
export const TOWER_GUARD_MASK_PROPERTY = "bomd:tower_guard_mask";
export const TOWER_ROTATION_PROPERTY = "bomd:tower_rotation";

export const COMBAT_RADIUS = 64;
export const LEASH_RADIUS = 50;
export const RESET_DELAY_TICKS = 200;
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

export const GAUNTLET_ANIMATION_STATE = Object.freeze({
  idle: 0,
  punch: 1,
  punchStop: 2,
  laser: 3,
  laserStop: 4,
  spin: 5,
  blindness: 6,
  death: 7,
  dormant: 8,
  awakening: 9
});

// Void Blossom — values mirror the Java 1.20.1 encounter wherever Bedrock
// exposes an equivalent. Damage remains at the original 12 points; the wider
// Bedrock collision checks are compensated with explicit telegraphs/i-frames.
export const VOID_BLOSSOM_TYPE = "bomd:void_blossom";
export const VOID_BLOSSOM_HITBOX_TYPE = "bomd:void_blossom_hitbox";
export const VOID_BLOSSOM_ANCHOR_TYPE = "bomd:void_blossom_anchor";
export const VOID_SPORE_TYPE = "bomd:void_spore_ball";
export const VOID_BLADE_TYPE = "bomd:void_petal_blade";
export const VOID_BLOSSOM_BLOCK = "bomd:void_blossom_healer";
export const VINE_WALL_BLOCK = "bomd:vine_wall";
export const VOID_LILY_BLOCK = "bomd:void_lily";
export const VOID_CAVERN_SEED_BLOCK = "bomd:void_blossom_cavern_seed";
export const VOID_CAVERN_SEED_STRUCTURE = "bomd:void_blossom_cavern_seed";
export const VOID_THORN_ITEM = "bomd:void_thorn";
export const CRYSTAL_FRUIT_ITEM = "bomd:crystal_fruit";
export const CHARGED_ENDER_PEARL_ITEM = "bomd:charged_ender_pearl";
export const CHARGED_ENDER_PEARL_TYPE = "bomd:charged_ender_pearl_projectile";
export const CHARGED_PEARL_OWNER_PROPERTY = "bomd:charged_pearl_owner";
export const EARTHDIVE_SPEAR_ITEM = "bomd:earthdive_spear";
export const BRIMSTONE_NECTAR_ITEM = "bomd:brimstone_nectar";
export const LEVITATION_BLOCK = "bomd:levitation_block";
export const MOB_WARD_BLOCK = "bomd:mob_ward";
export const MONOLITH_BLOCK = "bomd:monolith";

export const OBSIDILITH_TYPE = "bomd:obsidilith";
export const OBSIDIAN_HEART_ITEM = "bomd:obsidian_heart";
export const OBSIDILITH_END_FRAME_BLOCK = "bomd:obsidilith_end_frame";
export const OBSIDILITH_RUNE_BLOCK = "bomd:obsidilith_rune";
export const OBSIDILITH_ARENA_STRUCTURE = "bomd:obsidilith_arena";
export const OBSIDILITH_ANIMATION_STATE = Object.freeze({
  idle: 0,
  burst: 1,
  wave: 2,
  spikes: 3,
  anvil: 4,
  pillars: 5,
  death: 6,
  summon: 7,
  shielded: 8
});
export const OBSIDILITH_DAMAGE = 16;
export const OBSIDILITH_MAX_HEALTH = 300;
export const OBSIDILITH_COMBAT_RADIUS = 48;
export const OBSIDILITH_LEASH_RADIUS = 42;
export const OBSIDILITH_DEFEATED_PROPERTY = "bomd:obsidilith_defeated";
export const OBSIDILITH_PLANNED_PROPERTY = "bomd:obsidilith_planned";
export const OBSIDILITH_KNOWN_PROPERTY = "bomd:obsidilith_known";
export const OBSIDILITH_LOCATOR_SEED_PROPERTY = "bomd:obsidilith_locator_seed";
export const OBSIDILITH_HOME_X_PROPERTY = "bomd:obsidilith_home_x";
export const OBSIDILITH_HOME_Y_PROPERTY = "bomd:obsidilith_home_y";
export const OBSIDILITH_HOME_Z_PROPERTY = "bomd:obsidilith_home_z";
export const OBSIDILITH_RIFT_INDICATOR_PARTICLE = "bomd:obsidilith_rift_indicator";
export const OBSIDILITH_RIFT_PARTICLE = "bomd:obsidilith_rift";
export const OBSIDILITH_BURST_INDICATOR_PARTICLE = "bomd:obsidilith_burst_indicator";
export const OBSIDILITH_BURST_PARTICLE = "bomd:obsidilith_burst";
export const OBSIDILITH_WAVE_INDICATOR_PARTICLE = "bomd:obsidilith_wave_indicator";
export const OBSIDILITH_WAVE_PARTICLE = "bomd:obsidilith_wave";
export const OBSIDILITH_SPIKE_INDICATOR_PARTICLE = "bomd:obsidilith_spike_indicator";
export const OBSIDILITH_SPIKE_PARTICLE = "bomd:obsidilith_spike";
export const OBSIDILITH_ANVIL_INDICATOR_PARTICLE = "bomd:obsidilith_anvil_indicator";
export const OBSIDILITH_ANVIL_TRAIL_PARTICLE = "bomd:obsidilith_anvil_trail";
export const OBSIDILITH_PILLAR_RUNE_PARTICLE = "bomd:obsidilith_pillar_rune";
export const OBSIDILITH_PILLAR_SPAWN_PARTICLE = "bomd:obsidilith_pillar_spawn";

export const VOID_COMBAT_RADIUS = 32;
export const VOID_LEASH_RADIUS = 35;
export const VOID_IDLE_HEAL_PER_TICK = 0.5;
export const VOID_ATTACK_DAMAGE = 12;
export const VOID_DEATH_TICKS = 70;
export const VOID_INITIAL_COOLDOWN = 80;
export const VOID_HOME_X_PROPERTY = "bomd:void_home_x";
export const VOID_HOME_Y_PROPERTY = "bomd:void_home_y";
export const VOID_HOME_Z_PROPERTY = "bomd:void_home_z";
export const VOID_PREVIOUS_ATTACK_PROPERTY = "bomd:void_previous_attack";
export const VOID_STAGE_PROPERTY = "bomd:void_stage";
export const VOID_DYING_PROPERTY = "bomd:void_dying";
export const VOID_DEATH_END_TICK_PROPERTY = "bomd:void_death_end_tick";
export const VOID_SCALED_PLAYERS_PROPERTY = "bomd:void_scaled_players";
export const VOID_BALANCE_VERSION_PROPERTY = "bomd:void_balance_version";
export const VOID_HITBOX_OWNER_PROPERTY = "bomd:void_hitbox_owner";
export const VOID_HITBOX_STATE_PROPERTY = "bomd:void_hitbox_state";
export const VOID_HEALER_OWNER_PROPERTY = "bomd:void_healer_owner";
export const VOID_CAVERN_PLANNED_PROPERTY = "bomd:void_cavern_planned";
export const VOID_CAVERN_DEFEATED_PROPERTY = "bomd:void_cavern_defeated";
export const VOID_CAVERN_LOCATOR_SEED_PROPERTY = "bomd:void_cavern_locator_seed";

export const VOID_SPIKE_INDICATOR_PARTICLE = "bomd:void_spike_indicator";
export const VOID_SPIKE_PARTICLE = "bomd:void_spike";
export const VOID_WAVE_INDICATOR_PARTICLE = "bomd:void_wave_indicator";
export const VOID_SPORE_PARTICLE = "bomd:void_spore_cloud";
export const VOID_SPORE_IMPACT_PARTICLE = "bomd:void_spore_impact";
export const VOID_PETAL_PARTICLE = "bomd:void_petal";
export const VOID_HEAL_PARTICLE = "bomd:void_heal";
export const VOID_POLLEN_PARTICLE = "bomd:void_pollen";
export const CHARGED_PEARL_ROD_PARTICLE = "bomd:charged_pearl_rods";

export const VOID_ANIMATION_STATE = Object.freeze({
  idle: 0,
  spike: 1,
  spikeWave: 2,
  spore: 3,
  blade: 4,
  blossom: 5,
  spawn: 6,
  death: 7
});
