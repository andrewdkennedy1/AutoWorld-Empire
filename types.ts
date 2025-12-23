
export type TerrainType = 'plains' | 'forest' | 'mountain' | 'water' | 'desert';
export type FactionArchetype = 'order' | 'chaos' | 'commerce' | 'nature';
export type BuildingType = 'market' | 'farm' | 'barracks' | 'wall' | 'inn' | 'workshop' | 'watchtower';

export interface Tile {
  x: number;
  y: number;
  terrain: TerrainType;
  owner_faction_id: string | null;
  location_id: string | null;
}

export interface Building {
  id: string;
  type: BuildingType;
  level: number;
  owner_npc_id: string;
  status: 'active' | 'damaged' | 'building';
}

export interface Location {
  id: string;
  name: string;
  type: 'town' | 'outpost' | 'ruin' | 'capital';
  x: number;
  y: number;
  faction_id: string | null;
  population: number;
  buildings: Building[];
  defense: number;
  prosperity: number;
  unrest: number;
}

export interface TradeRoute {
  id: string;
  type: 'trade';
  from_location_id: string;
  to_location_id: string;
  commodity: string;
  volume: number;
  risk: number;
  status: 'active' | 'disrupted';
}

export interface Faction {
  id: string;
  name: string;
  archetype: FactionArchetype;
  ideology: string;
  leader_npc_id: string;
  resources: { gold: number; grain: number; iron: number };
  military: { troops: number; quality: number };
  relationships: { target_faction_id: string; type: 'hostile' | 'neutral' | 'allied'; score: number }[];
  laws: { id: string; text: string; enforcement: number }[];
}

export interface NPC {
  id: string;
  name: string;
  role: string;
  faction_id: string;
  traits: string[];
  goals: { id: string; text: string; priority: number }[];
  resources: { gold: number; influence: number };
  relationships: { target_id: string; type: string; score: number }[];
  memory: MemoryItem[];
  location_id: string;
  status: string;
  portraitUrl?: string; // Generated image URL
}

export interface MemoryItem {
  id: string;
  text: string;
  tags: string[];
  strength: number;
  created_epoch: number;
  last_reinforced_epoch: number;
}

export interface Commodity {
  id: string;
  base_price: number;
  current_price: number;
  supply: number;
  demand: number;
  volatility: number;
}

export interface Quest {
  id: string;
  title: string;
  status: 'open' | 'completed' | 'failed';
  giver_npc_id: string;
  objective: string;
  reward: { gold: number };
}

export interface EventLogEntry {
  id: string;
  epoch: number;
  type: string;
  title: string;
  summary: string;
  impact: any;
  decision_trace_id: string | null;
}

export interface DecisionTrace {
  decision_trace_id: string;
  epoch: number;
  actor: string;
  goal_summary: string[];
  retrieved_memories: { id: string; text: string; strength: number }[];
  world_facts_used: string[];
  plan_candidates: { plan: string; pros: string[]; cons: string[] }[];
  chosen_plan: string;
  tool_calls: { tool: string; inputs: any; outputs: any }[];
  world_diff_summary: string[];
  confidence: number;
}

export interface WorldDiff {
  epoch: number;
  title: string;
  diff: {
    added: string[];
    updated: string[];
    removed: string[];
  };
}

export interface WorldState {
  time: { day: number; hour: number; epoch: number };
  map: {
    width: number;
    height: number;
    tiles: Tile[];
    locations: Location[];
    routes: TradeRoute[];
  };
  factions: Faction[];
  npcs: NPC[];
  economy: {
    commodities: Commodity[];
    market_events: any[];
  };
  quests: Quest[];
  event_log: EventLogEntry[];
  decision_traces: DecisionTrace[];
}

export interface ThemeConfig {
  genre: string;
  threat: string;
  tone: string;
}

export interface WorldBundle {
  meta: {
    world_id: string;
    world_name: string;
    seed: string;
    created_at: string;
    version: string;
    rules: any;
    themeConfig?: ThemeConfig;
  };
  world_state: WorldState;
  world_diffs: WorldDiff[];
}
