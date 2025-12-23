import { WorldState, ToolResult, NPC } from '../types';

/**
 * Scout Agent Tool: Gathers information about resources or other factions.
 */
export const executeScout = (
  state: WorldState,
  agentId: string,
  targetLocation: string
): ToolResult => {
  const agent = state.npcs.find(n => n.id === agentId);
  if (!agent) return { success: false, message: 'Agent not found', updates: null };

  const foundEvents = Math.random() > 0.4; // 60% chance to find nothing interesting
  let message = `${agent.name} scouted ${targetLocation}.`;
  const newMemories = [];

  if (foundEvents) {
    message += ` Spotted increased activity.`;
    newMemories.push({ npcId: agentId, memory: `Saw increased activity at ${targetLocation} on day ${state.day}.` });
  } else {
    message += ` All clear.`;
    newMemories.push({ npcId: agentId, memory: `Scouted ${targetLocation}, nothing unusual.` });
  }

  return {
    success: true,
    message,
    updates: null, // Scouting is passive, no world state change other than memory
    newMemories
  };
};

/**
 * Merchant Agent Tool: Simulates economic trade or manipulation.
 */
export const executeTrade = (
  state: WorldState,
  agentId: string,
  action: 'BUY' | 'SELL' | 'HOARD'
): ToolResult => {
  const agent = state.npcs.find(n => n.id === agentId);
  if (!agent) return { success: false, message: 'Agent not found', updates: null };

  const currentPrice = state.resources.grainPrice;
  const currentStock = state.resources.grainStock;
  let newPrice = currentPrice;
  let newStock = currentStock;
  let message = '';
  
  if (action === 'BUY') {
    newStock = Math.max(0, currentStock - 50);
    newPrice = currentPrice + 2; // Price goes up
    message = `${agent.name} bought significant grain reserves.`;
  } else if (action === 'SELL') {
    newStock = currentStock + 50;
    newPrice = Math.max(1, currentPrice - 2); // Price goes down
    message = `${agent.name} flooded the market with grain.`;
  } else if (action === 'HOARD') {
    newStock = Math.max(0, currentStock - 100);
    newPrice = currentPrice + 5; // Artificial scarcity
    message = `${agent.name} is hoarding grain to drive up prices!`;
  }

  return {
    success: true,
    message,
    updates: {
      resources: { ...state.resources, grainPrice: newPrice, grainStock: newStock }
    },
    newMemories: [{ npcId: agentId, memory: `Executed market maneuver: ${action} on day ${state.day}. New price: ${newPrice}.` }]
  };
};

/**
 * Rumor Agent Tool: Spreads rumors to affect unrest or relationships.
 */
export const executeRumor = (
  state: WorldState,
  agentId: string,
  targetFaction: string,
  type: 'SLANDER' | 'PRAISE'
): ToolResult => {
  const agent = state.npcs.find(n => n.id === agentId);
  if (!agent) return { success: false, message: 'Agent not found', updates: null };

  let unrestChange = 0;
  let message = '';

  if (type === 'SLANDER') {
    unrestChange = 5;
    message = `${agent.name} spread nasty rumors about the ${targetFaction}. Unrest rises.`;
  } else {
    unrestChange = -5;
    message = `${agent.name} spread praise for the ${targetFaction}. Unrest falls.`;
  }

  const newUnrest = Math.max(0, Math.min(100, state.resources.unrest + unrestChange));

  return {
    success: true,
    message,
    updates: {
      resources: { ...state.resources, unrest: newUnrest }
    },
    newMemories: [{ npcId: agentId, memory: `Spread ${type} rumor about ${targetFaction}.` }]
  };
};

/**
 * Tactician Agent Tool: Combat simulation or security preparation.
 */
export const executeCombatOps = (
  state: WorldState,
  agentId: string,
  target: 'RAID' | 'PATROL'
): ToolResult => {
  const agent = state.npcs.find(n => n.id === agentId);
  if (!agent) return { success: false, message: 'Agent not found', updates: null };

  let message = '';
  let securityChange = 0;
  let stockChange = 0;
  
  if (target === 'RAID') {
    const success = Math.random() > 0.5; // 50% chance
    if (success) {
      stockChange = -50;
      securityChange = -10;
      message = `${agent.name} successfully led a raid! Grain stolen.`;
    } else {
      securityChange = 5; // Failed raid alerts guards
      message = `${agent.name}'s raid failed. Defenses tightened.`;
    }
  } else {
    securityChange = 10;
    message = `${agent.name} organized heavy patrols. Security increased.`;
  }

  const newSecurity = Math.max(0, Math.min(100, state.resources.securityLevel + securityChange));
  const newStock = Math.max(0, state.resources.grainStock + stockChange);

  return {
    success: true,
    message,
    updates: {
      resources: { ...state.resources, securityLevel: newSecurity, grainStock: newStock }
    },
    newMemories: [{ npcId: agentId, memory: `Conducted ${target} operation. Result: ${message}` }]
  };
};