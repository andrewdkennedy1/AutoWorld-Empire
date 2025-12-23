export enum FactionType {
  TOWN = 'Town Council',
  MERCHANT = 'Merchants Guild',
  BANDIT = 'Forest Bandits'
}

export enum AgentRole {
  MAYOR = 'Mayor',
  MERCHANT_LEADER = 'Merchant Leader',
  BANDIT_LEADER = 'Bandit Leader',
  CITIZEN = 'Citizen',
  GUARD = 'Guard'
}

export interface Memory {
  id: string;
  description: string;
  timestamp: number; // World tick
  strength: number; // 0-100, decays over time
  tags: string[];
  involvedIds: string[]; // IDs of NPCs/Locations involved
}

export interface NPC {
  id: string;
  name: string;
  role: AgentRole;
  faction: FactionType;
  appearance: string; // Visual description for image generation
  location: string;
  stats: {
    influence: number;
    wealth: number;
    combat: number;
  };
  goals: string[];
  memories: Memory[];
  relationships: Record<string, number>; // NPC_ID -> -100 (Hostile) to 100 (Friendly)
  status: string; // Current visible activity
}

export interface CustomTool {
  name: string;
  description: string;
  parameters: any; // JSON Schema object
  creatorId: string;
  createdTick: number;
}

export interface WorldEvent {
  id: string;
  tick: number;
  type: 'TICK' | 'SLEEP_CYCLE' | 'AGENT_ACTION' | 'WORLD_EVENT' | 'TOOL_INVENTION';
  description: string;
  narrative?: string; // AI generated story
  imageUrl?: string; // AI generated visualization
  sourceId?: string; // Who caused it
  trace?: DecisionTrace; // If autonomous
  impact?: string; // Summary of changes
}

export interface DecisionTrace {
  agentName: string;
  goal: string;
  retrievedMemories: string[];
  reasoning: string; // Gemini's thought process
  toolUsed: string;
  toolInput: Record<string, any>;
  toolOutput: Record<string, any>;
  stateDiff: string; // Description of what changed in JSON
  isThinking: boolean; // Flag to indicate if Thinking Mode was used
}

export interface ResourceState {
  grainPrice: number;
  grainStock: number;
  securityLevel: number; // 0-100
  unrest: number; // 0-100
}

export interface WorldState {
  tick: number;
  day: number;
  resources: ResourceState;
  npcs: NPC[];
  events: WorldEvent[];
  logs: string[]; // Simple string logs for the console view
  customTools: CustomTool[]; // Registry of AI-invented tools
}

export type ToolResult = {
  success: boolean;
  message: string;
  updates: Partial<WorldState> | null; // Updates to merge into state
  newMemories?: { npcId: string; memory: string }[];
};