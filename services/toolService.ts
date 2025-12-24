import { WorldState, Tile, Building, Location, TradeRoute, Faction, NPC, Commodity, WorldDiff } from '../types';

/**
 * Deterministic helper to find path between tiles using simple Manhattan distance for now (MVP).
 */
const getDistance = (x1: number, y1: number, x2: number, y2: number) => {
  return Math.abs(x1 - x2) + Math.abs(y1 - y2);
};

export const simulateEconomy = (state: WorldState): Partial<WorldState> => {
  const newCommodities = state.economy.commodities.map(c => {
    // Deterministic volatility
    const fluctuation = (Math.random() * c.volatility * 2) - c.volatility;
    
    // Supply/Demand impact
    const scarcity = c.demand / Math.max(1, c.supply);
    let priceChange = 0;
    
    if (scarcity > 1.2) priceChange += 1; // High demand
    if (scarcity < 0.8) priceChange -= 1; // Low demand
    
    // Apply trade route impacts
    const activeRoutes = state.map.routes.filter(r => r.commodity === c.id && r.status === 'active');
    // More routes = more stable supply = price towards base
    const routeFactor = activeRoutes.length * 0.5;
    
    let nextPrice = c.current_price + priceChange + fluctuation - (c.current_price > c.base_price ? routeFactor : -routeFactor);
    nextPrice = Math.max(1, parseFloat(nextPrice.toFixed(2)));

    return { ...c, current_price: nextPrice };
  });

  return {
    economy: { ...state.economy, commodities: newCommodities }
  };
};

export const buildStructure = (
  state: WorldState, 
  locationId: string, 
  buildingType: string, 
  ownerId: string, 
  cost: { gold: number, grain: number, iron: number }
): { success: boolean, message: string, updates: Partial<WorldState> | null } => {
  const locationIndex = state.map.locations.findIndex(l => l.id === locationId);
  if (locationIndex === -1) return { success: false, message: "Location not found", updates: null };
  
  const location = state.map.locations[locationIndex];
  const factionIndex = state.factions.findIndex(f => f.id === location.faction_id);
  const faction = state.factions[factionIndex];
  
  if (!faction) return { success: false, message: "Faction not found", updates: null };

  // Check resources
  if (faction.resources.gold < cost.gold || faction.resources.grain < cost.grain || faction.resources.iron < cost.iron) {
    return { success: false, message: `Insufficient resources. Needed: ${JSON.stringify(cost)}`, updates: null };
  }

  // Deduct cost
  const newResources = {
    gold: faction.resources.gold - cost.gold,
    grain: faction.resources.grain - cost.grain,
    iron: faction.resources.iron - cost.iron
  };

  // Add building
  const newBuilding: Building = {
    id: `bld_${Date.now()}_${Math.floor(Math.random()*1000)}`,
    type: buildingType as any,
    level: 1,
    owner_npc_id: ownerId,
    status: 'active'
  };

  const newLocations = [...state.map.locations];
  newLocations[locationIndex] = {
    ...location,
    buildings: [...(location.buildings || []), newBuilding],
    prosperity: location.prosperity + 5
  };

  const newFactions = [...state.factions];
  newFactions[factionIndex] = { ...faction, resources: newResources };

  return {
    success: true,
    message: `Built ${buildingType} in ${location.name}`,
    updates: {
      map: { ...state.map, locations: newLocations },
      factions: newFactions
    }
  };
};

export const generateWorldDiff = (prev: WorldState, curr: WorldState, epoch: number): WorldDiff => {
  const added: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  // Check Locations
  curr.map.locations.forEach(loc => {
    const pLoc = prev.map.locations.find(p => p.id === loc.id);
    if (!pLoc) added.push(`Location ${loc.name} founded`);
    else {
      if (pLoc.faction_id !== loc.faction_id) updated.push(`${loc.name} captured by new faction`);
      
      const prevBuildings = pLoc.buildings || [];
      const currBuildings = loc.buildings || [];
      
      if (prevBuildings.length !== currBuildings.length) updated.push(`New building in ${loc.name}`);
    }
  });

  // Check Economy
  curr.economy.commodities.forEach(c => {
    const pComm = prev.economy.commodities.find(pc => pc.id === c.id);
    if (pComm && Math.abs(pComm.current_price - c.current_price) > 1) {
      updated.push(`${c.id} price changed from ${pComm.current_price} to ${c.current_price}`);
    }
  });

  return {
    epoch,
    title: `Day ${curr.time.day} Changes`,
    diff: { added, updated, removed }
  };
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const applyInfluence = (
  state: WorldState,
  inputs: { target_type: 'faction' | 'location' | 'npc'; target_id: string; field: string; delta: number }
): { success: boolean; message: string; updates: Partial<WorldState> | null } => {
  const targetType = inputs.target_type;
  const targetId = inputs.target_id;
  const delta = clamp(inputs.delta, -50, 50);

  if (!targetId) return { success: false, message: 'Missing target_id', updates: null };

  if (targetType === 'faction') {
    const factionIndex = state.factions.findIndex(f => f.id === targetId);
    if (factionIndex === -1) return { success: false, message: 'Faction not found', updates: null };
    const faction = state.factions[factionIndex];
    const updated = { ...faction };
    if (inputs.field === 'resources.gold') updated.resources = { ...updated.resources, gold: Math.max(0, updated.resources.gold + delta) };
    if (inputs.field === 'resources.grain') updated.resources = { ...updated.resources, grain: Math.max(0, updated.resources.grain + delta) };
    if (inputs.field === 'resources.iron') updated.resources = { ...updated.resources, iron: Math.max(0, updated.resources.iron + delta) };
    if (inputs.field === 'military.troops') updated.military = { ...updated.military, troops: Math.max(0, updated.military.troops + delta) };
    if (inputs.field === 'military.quality') updated.military = { ...updated.military, quality: clamp(updated.military.quality + delta * 0.02, 0.2, 3) };

    const newFactions = [...state.factions];
    newFactions[factionIndex] = updated;
    return {
      success: true,
      message: `${faction.name} shifted`,
      updates: { factions: newFactions }
    };
  }

  if (targetType === 'location') {
    const locationIndex = state.map.locations.findIndex(l => l.id === targetId);
    if (locationIndex === -1) return { success: false, message: 'Location not found', updates: null };
    const location = state.map.locations[locationIndex];
    const updated = { ...location };
    const prosperity = Number(updated.prosperity || 0);
    const defense = Number(updated.defense || 0);
    const unrest = Number(updated.unrest || 0);
    const population = Number(updated.population || 0);
    if (inputs.field === 'prosperity') updated.prosperity = clamp(prosperity + delta, 0, 100);
    if (inputs.field === 'defense') updated.defense = clamp(defense + delta, 0, 100);
    if (inputs.field === 'unrest') updated.unrest = clamp(unrest + delta, 0, 100);
    if (inputs.field === 'population') updated.population = Math.max(0, population + delta);

    const newLocations = [...state.map.locations];
    newLocations[locationIndex] = updated;
    return {
      success: true,
      message: `${location.name} shifted`,
      updates: { map: { ...state.map, locations: newLocations } }
    };
  }

  if (targetType === 'npc') {
    const npcIndex = state.npcs.findIndex(n => n.id === targetId);
    if (npcIndex === -1) return { success: false, message: 'NPC not found', updates: null };
    const npc = state.npcs[npcIndex];
    const updated = { ...npc };
    if (inputs.field === 'resources.gold') updated.resources = { ...updated.resources, gold: Math.max(0, updated.resources.gold + delta) };
    if (inputs.field === 'resources.influence') updated.resources = { ...updated.resources, influence: Math.max(0, updated.resources.influence + delta) };

    const newNpcs = [...state.npcs];
    newNpcs[npcIndex] = updated;
    return {
      success: true,
      message: `${npc.name} shifted`,
      updates: { npcs: newNpcs }
    };
  }

  return { success: false, message: 'Unsupported target', updates: null };
};
