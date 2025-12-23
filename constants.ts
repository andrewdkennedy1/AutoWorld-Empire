import { FactionType, AgentRole, WorldState, NPC } from './types';

const INITIAL_NPCS: NPC[] = [
  // Town Faction
  {
    id: 'npc_mayor',
    name: 'Mayor Arin',
    role: AgentRole.MAYOR,
    faction: FactionType.TOWN,
    appearance: 'An elderly man with a neat salt-and-pepper beard, wearing deep crimson velvet robes and a heavy golden chain of office.',
    location: 'Town Hall',
    stats: { influence: 80, wealth: 50, combat: 10 },
    goals: ['Maintain order', 'Keep grain prices stable', 'Suppress bandits'],
    memories: [],
    relationships: { 'npc_merchant': 20, 'npc_bandit': -100 },
    status: 'Reviewing tax reports'
  },
  {
    id: 'npc_guard_cap',
    name: 'Captain Kael',
    role: AgentRole.GUARD,
    faction: FactionType.TOWN,
    appearance: 'A tall, scarred warrior in polished steel plate armor with a blue cape, carrying a broadsword.',
    location: 'Barracks',
    stats: { influence: 40, wealth: 20, combat: 85 },
    goals: ['Protect the town', 'Follow orders'],
    memories: [],
    relationships: { 'npc_mayor': 50 },
    status: 'Drilling recruits'
  },
  {
    id: 'npc_scholar',
    name: 'Scribe Elara',
    role: AgentRole.CITIZEN,
    faction: FactionType.TOWN,
    appearance: 'A young woman with glasses and ink-stained fingers, wearing simple brown scholarly robes and carrying a stack of scrolls.',
    location: 'Library',
    stats: { influence: 30, wealth: 15, combat: 5 },
    goals: ['Record history', 'Advise the Mayor'],
    memories: [],
    relationships: { 'npc_mayor': 10 },
    status: 'Organizing scrolls'
  },
  
  // Merchant Faction
  {
    id: 'npc_merchant',
    name: 'Guildmaster Thorne',
    role: AgentRole.MERCHANT_LEADER,
    faction: FactionType.MERCHANT,
    appearance: 'A portly man in extravagant silk clothes adorned with jewels, constantly fidgeting with a large ruby ring.',
    location: 'Market Square',
    stats: { influence: 60, wealth: 90, combat: 20 },
    goals: ['Maximize profit', 'Monopolize grain trade', 'Lower taxes'],
    memories: [],
    relationships: { 'npc_mayor': -10, 'npc_bandit': 10 }, // Secretly pays protection money
    status: 'Counting coins'
  },
  {
    id: 'npc_trader_1',
    name: 'Trader Jinx',
    role: AgentRole.CITIZEN,
    faction: FactionType.MERCHANT,
    appearance: 'A wiry individual with a leather apron and a quick smile, standing next to a mule laden with goods.',
    location: 'Trade Route',
    stats: { influence: 20, wealth: 40, combat: 30 },
    goals: ['Sell goods', 'Avoid bandits'],
    memories: [],
    relationships: { 'npc_merchant': 40 },
    status: 'Loading wagons'
  },

  // Bandit Faction
  {
    id: 'npc_bandit',
    name: 'Varg the Scarred',
    role: AgentRole.BANDIT_LEADER,
    faction: FactionType.BANDIT,
    appearance: 'A massive brute clad in dark furs and leather armor, wielding a jagged greataxe, with a distinctive scar running down his left eye.',
    location: 'Forest Camp',
    stats: { influence: 70, wealth: 30, combat: 90 },
    goals: ['Disrupt trade', 'Steal grain', 'Humiliate the Mayor'],
    memories: [],
    relationships: { 'npc_mayor': -100, 'npc_merchant': 10 },
    status: 'Sharpening axe'
  },
  {
    id: 'npc_scout_1',
    name: 'Scout Mira',
    role: AgentRole.CITIZEN,
    faction: FactionType.BANDIT,
    appearance: 'A hooded figure in camouflage green cloak, holding a longbow, blending into the forest shadows.',
    location: 'Forest Edge',
    stats: { influence: 10, wealth: 5, combat: 50 },
    goals: ['Find targets', 'Report to Varg'],
    memories: [],
    relationships: { 'npc_bandit': 60 },
    status: 'Watching the road'
  }
];

export const INITIAL_STATE: WorldState = {
  tick: 0,
  day: 1,
  resources: {
    grainPrice: 10,
    grainStock: 500,
    securityLevel: 60, // Moderate security
    unrest: 20 // Low unrest
  },
  npcs: INITIAL_NPCS,
  events: [],
  logs: ['World simulation started.'],
  customTools: []
};