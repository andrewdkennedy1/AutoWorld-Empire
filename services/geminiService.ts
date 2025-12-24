import { GoogleGenAI, Type, Modality } from "@google/genai";
import { WorldState, Faction, NPC, Location, Tile, DecisionTrace, WorldDiff, Commodity, ThemeConfig } from '../types';
import { retrieveMemories } from './memoryService';

// Model definitions
const PRO_MODEL = 'gemini-3-pro-preview'; 
const FLASH_MODEL = 'gemini-3-flash-preview';
const IMAGE_MODEL = 'gemini-2.5-flash-image';
const TTS_MODEL = 'gemini-2.5-flash-preview-tts';

/**
 * Utility for exponential backoff retries on 429 errors
 */
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
        console.warn(`Rate limited (429). Retrying in ${Math.round(delay)}ms... (Attempt ${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
};

const generateProceduralMap = (width: number, height: number): Tile[] => {
  const tiles: Tile[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let terrain: any = 'plains';
      const noise = Math.sin(x * 0.2) + Math.cos(y * 0.2) + Math.random() * 0.5;
      if (noise > 1.5) terrain = 'mountain';
      else if (noise > 1.0) terrain = 'forest';
      else if (noise < -0.5) terrain = 'water';
      tiles.push({ x, y, terrain, owner_faction_id: null, location_id: null });
    }
  }
  return tiles;
};

export const runGenesisAgent = async (seed: string, theme: ThemeConfig): Promise<Partial<WorldState>> => {
  return withRetry(async () => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const mapTiles = generateProceduralMap(24, 16);
    
    const prompt = `
      GENESIS AGENT: Create a new world based on seed "${seed}".
      USER SETTINGS: GENRE: ${theme.genre}, THREAT: ${theme.threat}, TONE: ${theme.tone}
      Generate: 3 Factions, 2-3 Locations (x:0-23, y:0-15), 6 NPCs, 1 Commodity config, 1 Initial Event Log.
      Output strict JSON.
    `;

    const response = await ai.models.generateContent({
      model: PRO_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            factions: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { id: {type: Type.STRING}, name: {type: Type.STRING}, archetype: {type: Type.STRING}, ideology: {type: Type.STRING}, resources: {type: Type.OBJECT, properties: {gold: {type: Type.NUMBER}, grain: {type: Type.NUMBER}, iron: {type: Type.NUMBER}}}, military: {type: Type.OBJECT, properties: {troops: {type: Type.NUMBER}, quality: {type: Type.NUMBER}}} } } },
            locations: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { id: {type: Type.STRING}, name: {type: Type.STRING}, type: {type: Type.STRING}, x: {type: Type.NUMBER}, y: {type: Type.NUMBER}, defense: {type: Type.NUMBER}, prosperity: {type: Type.NUMBER}, unrest: {type: Type.NUMBER} } } },
            npcs: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { id: {type: Type.STRING}, name: {type: Type.STRING}, role: {type: Type.STRING}, faction_id: {type: Type.STRING}, goals: {type: Type.ARRAY, items: {type: Type.OBJECT, properties: {id: {type: Type.STRING}, text: {type: Type.STRING}, priority: {type: Type.NUMBER}}}}, location_id: {type: Type.STRING} } } },
            commodities: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { id: {type: Type.STRING}, base_price: {type: Type.NUMBER}, current_price: {type: Type.NUMBER}, supply: {type: Type.NUMBER}, demand: {type: Type.NUMBER}, volatility: {type: Type.NUMBER} } } },
            initial_event: { type: Type.STRING }
          }
        }
      }
    });

    const data = JSON.parse(response.text || "{}");
    const finalTiles = mapTiles.map(t => {
      const loc = data.locations?.find((l: any) => l.x === t.x && l.y === t.y);
      if (loc) return { ...t, location_id: loc.id, owner_faction_id: loc.faction_id };
      return t;
    });

    return {
      map: { width: 24, height: 16, tiles: finalTiles, locations: (data.locations || []).map((l: any) => ({ ...l, buildings: [] })), routes: [] },
      factions: (data.factions || []).map((f: any) => ({ ...f, military: f.military || { troops: 50, quality: 1.0 }, relationships: [], laws: [] })),
      npcs: (data.npcs || []).map((n: any) => ({ ...n, memory: [], relationships: [], traits: [], status: 'idle', resources: { gold: 50, influence: 10 } })),
      economy: { commodities: data.commodities || [], market_events: [] },
      event_log: [{ id: 'evt_genesis', epoch: 0, type: 'genesis', title: 'World Created', summary: data.initial_event || 'The world begins.', impact: {}, decision_trace_id: null }]
    };
  });
};

export const generateLoadingMessages = async (theme: ThemeConfig): Promise<string[]> => {
  return withRetry(async () => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const prompt = `Generate exactly 5 short loading steps (max 4 words each) for creating a ${theme.genre} world. JSON array.`;
    const response = await ai.models.generateContent({
      model: FLASH_MODEL,
      contents: prompt,
      config: { responseMimeType: "application/json", responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } } }
    });
    return JSON.parse(response.text || "[]");
  });
};

export const runManagerAgent = async (
  manager: NPC,
  state: WorldState,
  theme?: ThemeConfig
): Promise<{ toolCalls: any[], trace: DecisionTrace }> => {
  // Use FLASH by default for managers to preserve quota
  return withRetry(async () => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const memories = retrieveMemories(manager, "current threats opportunities goal");
    const faction = state.factions.find(f => f.id === manager.faction_id);
    const themeContext = theme ? `CONTEXT: The world genre is ${theme.genre} (${theme.tone}). Threats: ${theme.threat}.` : '';

    const prompt = `
      You are ${manager.name}, the ${manager.role} of ${faction?.name}.
      ${themeContext}
      Goals: ${manager.goals.map(g => g.text).join(', ')}.
      Task: Decide on a strategic move and spawn a sub-agent.
    `;

    const TOOLS = [
      {
        name: 'build_structure',
        description: 'Spawn BuilderAgent to construct a building.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            location_id: { type: Type.STRING },
            building_type: { type: Type.STRING, enum: ['market', 'farm', 'barracks', 'wall'] },
            cost_gold: { type: Type.NUMBER },
            cost_grain: { type: Type.NUMBER }
          },
          required: ['location_id', 'building_type', 'cost_gold', 'cost_grain']
        }
      },
      {
        name: 'simulate_combat',
        description: 'Spawn TacticianAgent to manage combat.',
        parameters: {
          type: Type.OBJECT,
          properties: { target_faction_id: { type: Type.STRING }, location_id: { type: Type.STRING } },
          required: ['target_faction_id', 'location_id']
        }
      }
    ];

    const response = await ai.models.generateContent({
      model: FLASH_MODEL,
      contents: prompt,
      config: {
        tools: [{ functionDeclarations: TOOLS }]
      }
    });

    const cand = response.candidates?.[0];
    const fc = cand?.content?.parts?.find(p => p.functionCall);

    const trace: DecisionTrace = {
      decision_trace_id: `trace_${Date.now()}`,
      epoch: state.time.epoch,
      actor: manager.name,
      goal_summary: manager.goals.map(g => g.text),
      retrieved_memories: memories.map(m => ({ id: m.id, text: m.text, strength: m.strength })),
      world_facts_used: [`Day ${state.time.day}`],
      plan_candidates: [{ plan: "Action", pros: [], cons: [] }],
      chosen_plan: fc ? fc.functionCall.name : "Wait",
      tool_calls: fc ? [{ tool: fc.functionCall.name, inputs: fc.functionCall.args, outputs: null }] : [],
      world_diff_summary: [],
      confidence: 0.8
    };

    return { toolCalls: fc ? [fc.functionCall] : [], trace };
  });
};

export const runHistoryAgent = async (logs: string[]): Promise<string> => {
  return withRetry(async () => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const prompt = `Summarize these world events into a single punchy log entry: ${logs.join('; ')}`;
    const response = await ai.models.generateContent({ model: FLASH_MODEL, contents: prompt });
    return response.text || "Daily events concluded.";
  });
};

export const generateCharacterPortrait = async (npc: NPC, factionName: string, theme?: ThemeConfig): Promise<string | null> => {
  return withRetry(async () => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const genre = theme?.genre || 'Fantasy';
    const prompt = `A highly detailed character portrait of ${npc.name}, a ${npc.role} of the ${factionName} faction. Setting: ${genre}. Cinematic digital art.`;
    
    const response = await ai.models.generateContent({
      model: IMAGE_MODEL,
      contents: { parts: [{ text: prompt }] },
      config: { imageConfig: { aspectRatio: "1:1" } }
    });

    const parts = response.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.inlineData) {
        return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      }
    }
    return null;
  }).catch(() => null);
};

export const interactWithNPC = async (npc: NPC, factionName: string, history: {role: string, text: string}[], userMessage: string): Promise<string> => {
  return withRetry(async () => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const prompt = `You are ${npc.name}, a ${npc.role} in ${factionName}. Respond in character. Concisely.`;
    const chatHistory = history.map(h => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.text }] }));
    const chat = ai.chats.create({ model: FLASH_MODEL, config: { systemInstruction: prompt }, history: chatHistory as any });
    const result = await chat.sendMessage({ message: userMessage });
    return result.text || "...";
  });
};

export const generateSpeech = async (text: string, voiceName: string = 'Kore'): Promise<string | null> => {
  return withRetry(async () => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: TTS_MODEL,
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
      },
    });
    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
  }).catch(() => null);
};
