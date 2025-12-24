import { GoogleGenAI, Type } from "@google/genai";
import { WorldState } from '../types';

const MODEL = 'gemini-3-flash-preview'; 

const withRetry = async <T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> => {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const errorMsg = error?.message || "";
      if (errorMsg.includes("429") || errorMsg.includes("quota") || errorMsg.includes("RESOURCE_EXHAUSTED")) {
        const delay = Math.pow(2, i + 1) * 1000 + Math.random() * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
};

export const resolveCombatConflict = async (
  state: WorldState,
  attackerFactionId: string,
  defenderFactionId: string,
  locationId: string
): Promise<{ outcome: string, updates: Partial<WorldState> }> => {
  return withRetry(async () => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const attacker = state.factions.find(f => f.id === attackerFactionId);
    const defender = state.factions.find(f => f.id === defenderFactionId);
    const location = state.map.locations.find(l => l.id === locationId);

    if (!attacker || !defender || !location) {
      return { outcome: "The fog of war prevents resolution.", updates: {} };
    }

    const prompt = `
      ROLE: Arbiter. Resolving battle: ${attacker.name} vs ${defender.name} at ${location.name}.
      ATTACKER: ${attacker.military.troops} troops, ${attacker.military.quality} quality.
      DEFENDER: ${defender.military.troops} troops, defenses: ${location.defense}.
      Determine outcome. JSON output.
    `;

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
          }
        }
      }
    });

    const result = JSON.parse(response.text || "{}");
    const newFactions = [...state.factions];
    const newLocations = [...state.map.locations];
    const attIndex = newFactions.findIndex(f => f.id === attackerFactionId);
    const defIndex = newFactions.findIndex(f => f.id === defenderFactionId);
    const locIndex = newLocations.findIndex(l => l.id === locationId);

    const attLosses = Math.min(newFactions[attIndex].military.troops, result.attacker_casualties || 0);
    const defLosses = Math.min(newFactions[defIndex].military.troops, result.defender_casualties || 0);

    newFactions[attIndex] = { ...newFactions[attIndex], military: { ...newFactions[attIndex].military, troops: newFactions[attIndex].military.troops - attLosses } };
    newFactions[defIndex] = { ...newFactions[defIndex], military: { ...newFactions[defIndex].military, troops: newFactions[defIndex].military.troops - defLosses } };

    let currentLoc = newLocations[locIndex];
    if (result.location_conquered) {
      currentLoc = { ...currentLoc, faction_id: attacker.id, defense: Math.max(0, currentLoc.defense - 10), unrest: 100 };
    } else {
      currentLoc = { ...currentLoc, defense: Math.max(0, currentLoc.defense - (result.defense_damage || 0)), unrest: Math.min(100, currentLoc.unrest + (result.unrest_change || 0)) };
    }
    newLocations[locIndex] = currentLoc;

    return {
      outcome: `${result.narrative} (Losses: ${attLosses}v${defLosses})`,
      updates: { factions: newFactions, map: { ...state.map, locations: newLocations } }
    };
  });
};
