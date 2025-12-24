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