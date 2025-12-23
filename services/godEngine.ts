import { GoogleGenAI, Type } from "@google/genai";
import { WorldState } from '../types';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
// Using Flash for speed, or Pro if depth is needed. Flash is good for a rapid God Engine.
const MODEL = 'gemini-3-flash-preview'; 

export const resolveCombatConflict = async (
  state: WorldState,
  attackerFactionId: string,
  defenderFactionId: string,
  locationId: string
): Promise<{ outcome: string, updates: Partial<WorldState> }> => {
  const attacker = state.factions.find(f => f.id === attackerFactionId);
  const defender = state.factions.find(f => f.id === defenderFactionId);
  const location = state.map.locations.find(l => l.id === locationId);

  // Validation
  if (!attacker || !defender || !location) {
    return { outcome: "The fog of war prevents resolution (Invalid IDs).", updates: {} };
  }

  const prompt = `
    ROLE: You are the GOD ENGINE, the omniscient arbiter of reality in this simulation.
    TASK: Resolve a battle between two factions without using RNG. Use logic, narrative stakes, and the balance of power.

    COMBATANTS:
    1. ATTACKER: ${attacker.name} (Archetype: ${attacker.archetype})
       - Troops: ${attacker.military.troops}
       - Quality/Tech: ${attacker.military.quality.toFixed(1)}
    
    2. DEFENDER: ${defender.name} (Archetype: ${defender.archetype})
       - Troops: ${defender.military.troops}
       - Quality/Tech: ${defender.military.quality.toFixed(1)}
    
    BATTLEFIELD:
    - Location: ${location.name} (${location.type})
    - Defenses: ${location.defense}
    - Current Unrest: ${location.unrest}
    - Population: ${location.population}

    INSTRUCTIONS:
    Determine the outcome. Did the walls breach? Did the defenders hold? Was it a slaughter or a standoff?
    The attacker generally needs superior numbers or quality to take a fortified location.
    
    OUTPUT JSON:
    {
      "narrative": "A dramatic 1-sentence summary of the battle's climax.",
      "attacker_casualties": number (Integer, cannot exceed attacker troops),
      "defender_casualties": number (Integer, cannot exceed defender troops),
      "location_conquered": boolean (True if attacker captures the location),
      "defense_damage": number (0-20, damage to walls/forts),
      "unrest_change": number (-10 to +50)
    }
  `;

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            narrative: { type: Type.STRING },
            attacker_casualties: { type: Type.NUMBER },
            defender_casualties: { type: Type.NUMBER },
            location_conquered: { type: Type.BOOLEAN },
            defense_damage: { type: Type.NUMBER },
            unrest_change: { type: Type.NUMBER }
          },
          required: ["narrative", "attacker_casualties", "defender_casualties", "location_conquered"]
        }
      }
    });

    const result = JSON.parse(response.text || "{}");

    // --- APPLY GOD ENGINE DECREE TO STATE ---
    
    const newFactions = [...state.factions];
    const newLocations = [...state.map.locations];
    
    const attIndex = newFactions.findIndex(f => f.id === attackerFactionId);
    const defIndex = newFactions.findIndex(f => f.id === defenderFactionId);
    const locIndex = newLocations.findIndex(l => l.id === locationId);

    if (attIndex === -1 || defIndex === -1 || locIndex === -1) {
       throw new Error("Entity missing during update");
    }

    // 1. Apply Casualties
    const attLosses = Math.min(newFactions[attIndex].military.troops, result.attacker_casualties || 0);
    const defLosses = Math.min(newFactions[defIndex].military.troops, result.defender_casualties || 0);

    newFactions[attIndex] = {
      ...newFactions[attIndex],
      military: { 
        ...newFactions[attIndex].military, 
        troops: newFactions[attIndex].military.troops - attLosses 
      }
    };

    newFactions[defIndex] = {
      ...newFactions[defIndex],
      military: { 
        ...newFactions[defIndex].military, 
        troops: newFactions[defIndex].military.troops - defLosses 
      }
    };

    // 2. Apply Location Changes
    let currentLoc = newLocations[locIndex];
    
    const newDefense = Math.max(0, currentLoc.defense - (result.defense_damage || 0));
    const newUnrest = Math.min(100, Math.max(0, currentLoc.unrest + (result.unrest_change || 0)));

    let conquestText = "";
    if (result.location_conquered) {
      currentLoc = {
        ...currentLoc,
        faction_id: attacker.id,
        defense: Math.max(0, newDefense - 10), // Extra damage on sack
        unrest: 100 // Maximum unrest on conquest
      };
      conquestText = ` ${attacker.name} has SEIZED control!`;
    } else {
      currentLoc = {
        ...currentLoc,
        defense: newDefense,
        unrest: newUnrest
      };
      conquestText = ` ${defender.name} held the line.`;
    }
    
    newLocations[locIndex] = currentLoc;

    return {
      outcome: `${result.narrative} (Lost: ${attLosses} vs ${defLosses}).${conquestText}`,
      updates: {
        factions: newFactions,
        map: { ...state.map, locations: newLocations }
      }
    };

  } catch (e) {
    console.error("God Engine Failure:", e);
    // Fallback: Deterministic Skirmish
    const troopsDiff = attacker.military.troops - defender.military.troops;
    return {
      outcome: "A chaotic skirmish erupted, but the dust settles with no clear victor.",
      updates: {}
    };
  }
};
