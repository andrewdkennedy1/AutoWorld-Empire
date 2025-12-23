import { GoogleGenAI, Type, Modality } from "@google/genai";
import { WorldState, Faction, NPC, Location, Tile, DecisionTrace, WorldDiff, Commodity, ThemeConfig } from '../types';
import { retrieveMemories } from './memoryService';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const MODEL = 'gemini-3-pro-preview';
const IMAGE_MODEL = 'gemini-2.5-flash-image';
const TTS_MODEL = 'gemini-2.5-flash-preview-tts';

/**
 * Procedural Map Generation (Hybrid Genesis)
 * We generate the tiles procedurally to save tokens and ensure geometry,
 * then ask Gemini to populate the "Content".
 */
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
  const mapTiles = generateProceduralMap(24, 16);
  
  const prompt = `
    GENESIS AGENT: Create a new world based on seed "${seed}".
    
    USER SETTINGS (Customize names, roles, and descriptions based on this):
    - GENRE: ${theme.genre}
    - MAJOR THREAT: ${theme.threat}
    - TONE: ${theme.tone}

    You need to generate:
    1. 3 Factions (Order, Commerce, Chaos) - Names must match the GENRE.
    2. 2-3 Locations (Town, Outpost) - specify coordinates x (0-23), y (0-15).
    3. 6 NPCs (Leader, Merchant, Guard, etc) assigned to factions/locations.
    4. 1 Commodity (e.g. Grain, Microchips, Mana) config matching the GENRE.
    5. 1 Initial Event Log entry setting the scene.

    Output strict JSON compatible with the Schema.
  `;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          factions: { 
            type: Type.ARRAY, 
            items: { 
              type: Type.OBJECT, 
              properties: { 
                id: {type: Type.STRING}, 
                name: {type: Type.STRING}, 
                archetype: {type: Type.STRING}, 
                ideology: {type: Type.STRING}, 
                resources: {
                  type: Type.OBJECT, 
                  properties: {gold: {type: Type.NUMBER}, grain: {type: Type.NUMBER}, iron: {type: Type.NUMBER}}
                },
                military: {
                  type: Type.OBJECT,
                  properties: {troops: {type: Type.NUMBER}, quality: {type: Type.NUMBER}}
                }
              } 
            } 
          },
          locations: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { id: {type: Type.STRING}, name: {type: Type.STRING}, type: {type: Type.STRING}, x: {type: Type.NUMBER}, y: {type: Type.NUMBER}, defense: {type: Type.NUMBER}, prosperity: {type: Type.NUMBER}, unrest: {type: Type.NUMBER} } } },
          npcs: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { id: {type: Type.STRING}, name: {type: Type.STRING}, role: {type: Type.STRING}, faction_id: {type: Type.STRING}, goals: {type: Type.ARRAY, items: {type: Type.OBJECT, properties: {id: {type: Type.STRING}, text: {type: Type.STRING}, priority: {type: Type.NUMBER}}}}, location_id: {type: Type.STRING} } } },
          commodities: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { id: {type: Type.STRING}, base_price: {type: Type.NUMBER}, current_price: {type: Type.NUMBER}, supply: {type: Type.NUMBER}, demand: {type: Type.NUMBER}, volatility: {type: Type.NUMBER} } } },
          initial_event: { type: Type.STRING }
        }
      }
    }
  });

  const data = JSON.parse(response.text || "{}");
  
  // Hydrate the procedural map with generated locations
  const finalTiles = mapTiles.map(t => {
    const loc = data.locations?.find((l: any) => l.x === t.x && l.y === t.y);
    if (loc) return { ...t, location_id: loc.id, owner_faction_id: loc.faction_id };
    return t;
  });

  return {
    map: { width: 24, height: 16, tiles: finalTiles, locations: data.locations || [], routes: [] },
    // Ensure military and other properties exist even if AI omitted them
    factions: (data.factions || []).map((f: any) => ({
      ...f,
      military: f.military || { troops: 50, quality: 1.0 },
      relationships: f.relationships || [],
      laws: f.laws || []
    })),
    npcs: (data.npcs || []).map((n: any) => ({ ...n, memory: [], relationships: [], traits: [], status: 'idle', resources: { gold: 50, influence: 10 } })),
    economy: { commodities: data.commodities || [], market_events: [] },
    event_log: [{ 
      id: 'evt_genesis', epoch: 0, type: 'genesis', title: 'World Created', 
      summary: data.initial_event || 'The world begins.', 
      impact: {}, decision_trace_id: null 
    }]
  };
};

/**
 * Manager Agent: Plans high-level actions and spawns Sub-Agents (via Tool Calls).
 */
export const runManagerAgent = async (
  manager: NPC,
  state: WorldState,
  theme?: ThemeConfig
): Promise<{ toolCalls: any[], trace: DecisionTrace }> => {
  const memories = retrieveMemories(manager, "current threats opportunities goal");
  const faction = state.factions.find(f => f.id === manager.faction_id);
  
  const themeContext = theme ? `CONTEXT: The world genre is ${theme.genre} (${theme.tone}). Threats: ${theme.threat}. Act accordingly.` : '';

  const prompt = `
    You are ${manager.name}, the ${manager.role} of ${faction?.name}.
    ${themeContext}
    Goals: ${manager.goals.map(g => g.text).join(', ')}.
    Memories: ${memories.map(m => m.text).join('; ')}.
    Resources: Gold ${faction?.resources.gold}, Grain ${faction?.resources.grain}.
    
    Situation: Day ${state.time.day}. Unrest is ${state.map.locations.find(l => l.id === manager.location_id)?.unrest || 0}.
    
    Task: Decide on a strategic move. Spawn a sub-agent to execute it.
    Available Tools (Sub-Agents):
    - build_structure (BuilderAgent): Construct buildings.
    - simulate_combat (TacticianAgent): Attack or Defend.
    - simulate_economy (MerchantAgent): Trade.
    
    Output a decision with reasoning and a tool call.
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
        properties: {
          target_faction_id: { type: Type.STRING },
          location_id: { type: Type.STRING }
        },
        required: ['target_faction_id', 'location_id']
      }
    }
  ];

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      tools: [{ functionDeclarations: TOOLS }],
      thinkingConfig: { thinkingBudget: 4000 }
    }
  });

  const cand = response.candidates?.[0];
  const fc = cand?.content?.parts?.find(p => p.functionCall);
  const reasoning = cand?.content?.parts?.find(p => p.text)?.text || "Executing routine duties.";

  const trace: DecisionTrace = {
    decision_trace_id: `trace_${Date.now()}`,
    epoch: state.time.epoch,
    actor: manager.name,
    goal_summary: manager.goals.map(g => g.text),
    retrieved_memories: memories,
    world_facts_used: [`Day ${state.time.day}`],
    plan_candidates: [{ plan: "Action", pros: [], cons: [] }],
    chosen_plan: fc ? fc.functionCall.name : "Wait",
    tool_calls: fc ? [{ tool: fc.functionCall.name, inputs: fc.functionCall.args, outputs: null }] : [],
    world_diff_summary: [],
    confidence: 0.8
  };

  return {
    toolCalls: fc ? [fc.functionCall] : [],
    trace
  };
};

export const runHistoryAgent = async (logs: string[]): Promise<string> => {
  const prompt = `
    History Agent: Summarize these events into a single punchy log entry title and summary.
    Events: ${logs.join('; ')}
  `;
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt
  });
  return response.text || "Daily events concluded.";
};

export const generateCharacterPortrait = async (npc: NPC, factionName: string, theme?: ThemeConfig): Promise<string | null> => {
  const genre = theme?.genre || 'Fantasy';
  const tone = theme?.tone || 'Detailed';
  const prompt = `A character portrait of ${npc.name}, a ${npc.role} belonging to the ${factionName} faction. 
  Setting: ${genre}, ${tone}. High quality, detailed digital art, close-up face shot.`;

  try {
    const response = await ai.models.generateContent({
      model: IMAGE_MODEL,
      contents: {
        parts: [{ text: prompt }]
      },
      config: {
        imageConfig: { aspectRatio: "1:1" }
      }
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    return null;
  } catch (e) {
    console.error("Image generation failed", e);
    return null;
  }
};

export const interactWithNPC = async (
  npc: NPC, 
  factionName: string, 
  history: {role: string, text: string}[], 
  userMessage: string
): Promise<string> => {
  const memories = retrieveMemories(npc, userMessage, 2);
  const prompt = `
    You are ${npc.name}, a ${npc.role} in the ${factionName} faction.
    Your goals: ${npc.goals.map(g => g.text).join(', ')}.
    Relevant memories: ${memories.map(m => m.text).join('; ')}.
    
    A traveler (the user) approaches you.
    Respond to them in character. Be concise (max 2 sentences).
  `;

  // Construct chat history
  const chatHistory = history.map(h => ({
    role: h.role === 'user' ? 'user' : 'model',
    parts: [{ text: h.text }]
  }));

  const chat = ai.chats.create({
    model: MODEL,
    config: { systemInstruction: prompt },
    history: chatHistory
  });

  const result = await chat.sendMessage({ message: userMessage });
  return result.text || "...";
};

export const generateSpeech = async (text: string, voiceName: string = 'Kore'): Promise<string | null> => {
  try {
    const response = await ai.models.generateContent({
      model: TTS_MODEL,
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });

    const base64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    return base64 || null;
  } catch (e) {
    console.error("TTS generation failed", e);
    return null;
  }
};
