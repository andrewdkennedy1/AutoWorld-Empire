import { WorldState, WorldBundle } from './types';

export const INITIAL_RULES = {
  tick_minutes: 60, // 1 tick = 1 hour
  daily_decay_multiplier: 0.90,
  reinforce_amount: 0.2,
  max_memory_strength: 1.0,
  max_agents_per_sleep: 3,
  max_major_events_per_sleep: 3
};

export const EMPTY_STATE: WorldState = {
  time: { day: 1, hour: 0, epoch: 0 },
  map: {
    width: 24,
    height: 16,
    tiles: [],
    locations: [],
    routes: []
  },
  factions: [],
  npcs: [],
  economy: {
    commodities: [],
    market_events: []
  },
  quests: [],
  event_log: [],
  decision_traces: []
};

export const INITIAL_BUNDLE: WorldBundle = {
  meta: {
    world_id: 'auto-empire-init',
    world_name: 'New World',
    seed: 'default',
    created_at: new Date().toISOString(),
    version: '1.0',
    rules: INITIAL_RULES,
    themeConfig: {
      genre: 'High Fantasy',
      threat: 'Bandits & Monsters',
      tone: 'Adventure'
    }
  },
  world_state: EMPTY_STATE,
  world_diffs: []
};

export const TERRAIN_COLORS: Record<string, string> = {
  plains: '#9ece6a', // Green
  forest: '#41a6b5', // Teal-ish green
  mountain: '#565f89', // Grey
  water: '#2ac3de', // Blue
  desert: '#e0af68'  // Yellow
};