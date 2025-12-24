import { GoogleGenAI, Type, Modality } from "@google/genai";
import { WorldState, Faction, NPC, Location, Tile, DecisionTrace, WorldDiff, Commodity, ThemeConfig } from '../types';
import { retrieveMemories } from './memoryService';
import { API_KEY_REQUIRED_MESSAGE, getProviderConfig, resolveApiKey } from './aiSettings';
import { describeTools } from './toolDb';
import type { AgentTool, ToolDB } from './toolDb';

// Model definitions
const PRO_MODEL = 'gemini-3-pro-preview'; 
const FLASH_MODEL = 'gemini-3-flash-preview';
const IMAGE_MODEL = 'gemini-2.5-flash-image';
const TTS_MODEL = 'gemini-2.5-flash-preview-tts';
const safeJsonParse = <T,>(value: string, fallback: T): T => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const getAiProviderKey = () => {
  const apiKey = resolveApiKey('gemini');
  if (!apiKey) {
    throw new Error(API_KEY_REQUIRED_MESSAGE);
  }
  return apiKey;
};

const createAiClient = () => new GoogleGenAI({ apiKey: getAiProviderKey() });

const assertProviderBaseUrl = (baseUrl: string) => {
  if (!baseUrl) {
    throw new Error('Provider base URL is required.');
  }
};

type OpenAIMessage = { role: 'system' | 'user' | 'assistant'; content: string };
type OpenAITool = {
  type: 'function';
  function: { name: string; description?: string; parameters: Record<string, any> };
};

const callOpenAIChat = async (params: {
  messages: OpenAIMessage[];
  tools?: OpenAITool[];
  responseFormat?: { type: 'json_object' };
}) => {
  const provider = getProviderConfig();
  assertProviderBaseUrl(provider.baseUrl);

  const apiKey = provider.requiresKey ? resolveApiKey(provider.providerId) : null;
  if (provider.requiresKey && !apiKey) {
    throw new Error(API_KEY_REQUIRED_MESSAGE);
  }

  const payload: Record<string, any> = {
    model: provider.model,
    messages: params.messages,
  };

  if (params.tools && params.tools.length > 0) {
    payload.tools = params.tools;
    payload.tool_choice = 'auto';
  }

  if (params.responseFormat && provider.supportsResponseFormat) {
    payload.response_format = params.responseFormat;
  }

  const baseUrl = provider.baseUrl.replace(/\/$/, '');
  const endpoint = baseUrl.includes('/chat/completions')
    ? baseUrl
    : baseUrl.endsWith('/v1')
      ? `${baseUrl}/chat/completions`
      : `${baseUrl}/v1/chat/completions`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Provider error (${response.status})`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message || {};
};

const parseOpenAIToolCalls = (message: any) => {
  const toolCalls = message?.tool_calls || [];
  return toolCalls.map((call: any) => ({
    name: call.function?.name,
    args: safeJsonParse(call.function?.arguments || "{}", {}),
  })).filter((call: any) => call.name);
};

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
    const provider = getProviderConfig();
    const mapTiles = generateProceduralMap(24, 16);

    const prompt = `
      GENESIS AGENT: Create a new world based on seed "${seed}".
      USER SETTINGS: GENRE: ${theme.genre}, THREAT: ${theme.threat}, TONE: ${theme.tone}
      Generate: 3 Factions, 2-3 Locations (x:0-23, y:0-15) with population and faction_id, 6 NPCs, 1 Commodity config, 1 Initial Event Log.
      Output strict JSON.
    `;

    let data: any = {};
    if (provider.providerId === 'gemini') {
      const ai = createAiClient();
      const response = await ai.models.generateContent({
        model: PRO_MODEL,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              factions: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { id: {type: Type.STRING}, name: {type: Type.STRING}, archetype: {type: Type.STRING}, ideology: {type: Type.STRING}, resources: {type: Type.OBJECT, properties: {gold: {type: Type.NUMBER}, grain: {type: Type.NUMBER}, iron: {type: Type.NUMBER}}}, military: {type: Type.OBJECT, properties: {troops: {type: Type.NUMBER}, quality: {type: Type.NUMBER}}} } } },
              locations: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { id: {type: Type.STRING}, name: {type: Type.STRING}, type: {type: Type.STRING}, x: {type: Type.NUMBER}, y: {type: Type.NUMBER}, faction_id: {type: Type.STRING}, population: {type: Type.NUMBER}, defense: {type: Type.NUMBER}, prosperity: {type: Type.NUMBER}, unrest: {type: Type.NUMBER} } } },
              npcs: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { id: {type: Type.STRING}, name: {type: Type.STRING}, role: {type: Type.STRING}, faction_id: {type: Type.STRING}, goals: {type: Type.ARRAY, items: {type: Type.OBJECT, properties: {id: {type: Type.STRING}, text: {type: Type.STRING}, priority: {type: Type.NUMBER}}}}, location_id: {type: Type.STRING} } } },
              commodities: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { id: {type: Type.STRING}, base_price: {type: Type.NUMBER}, current_price: {type: Type.NUMBER}, supply: {type: Type.NUMBER}, demand: {type: Type.NUMBER}, volatility: {type: Type.NUMBER} } } },
              initial_event: { type: Type.STRING }
            }
          }
        }
      });
      data = safeJsonParse(response.text || "{}", {});
    } else {
      const message = await callOpenAIChat({
        messages: [
          { role: 'system', content: 'You generate structured world data for a strategy simulation.' },
          { role: 'user', content: prompt }
        ],
        responseFormat: { type: 'json_object' }
      });
      data = safeJsonParse(message.content || "{}", {});
    }

    const finalTiles = mapTiles.map(t => {
      const loc = data.locations?.find((l: any) => l.x === t.x && l.y === t.y);
      if (loc) return { ...t, location_id: loc.id, owner_faction_id: loc.faction_id };
      return t;
    });

    return {
      map: { width: 24, height: 16, tiles: finalTiles, locations: (data.locations || []).map((l: any) => ({ ...l, buildings: [], population: l.population || 1200 })), routes: [] },
      factions: (data.factions || []).map((f: any) => ({ ...f, military: f.military || { troops: 50, quality: 1.0 }, relationships: [], laws: [] })),
      npcs: (data.npcs || []).map((n: any) => ({ ...n, memory: [], relationships: [], traits: [], status: 'idle', resources: { gold: 50, influence: 10 } })),
      economy: { commodities: data.commodities || [], market_events: [] },
      event_log: [{ id: 'evt_genesis', epoch: 0, type: 'genesis', title: 'World Created', summary: data.initial_event || 'The world begins.', impact: {}, decision_trace_id: null }]
    };
  });
};

export const generateLoadingMessages = async (theme: ThemeConfig): Promise<string[]> => {
  return withRetry(async () => {
    const prompt = `Generate exactly 5 short loading steps (max 4 words each) for creating a ${theme.genre} world. JSON array.`;
    const provider = getProviderConfig();
    if (provider.providerId === 'gemini') {
      const ai = createAiClient();
      const response = await ai.models.generateContent({
        model: FLASH_MODEL,
        contents: prompt,
        config: { responseMimeType: "application/json", responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } } }
      });
      return safeJsonParse(response.text || "[]", []);
    }

    const message = await callOpenAIChat({
      messages: [
        { role: 'system', content: 'You output concise JSON arrays.' },
        { role: 'user', content: prompt }
      ]
    });
    const parsed = safeJsonParse(message.content || "[]", []);
    return Array.isArray(parsed) ? parsed : (parsed.steps || []);
  });
};

export const runManagerAgent = async (
  manager: NPC,
  state: WorldState,
  theme?: ThemeConfig,
  toolDb?: ToolDB
): Promise<{ toolCalls: any[], trace: DecisionTrace }> => {
  // Use FLASH by default for managers to preserve quota
  return withRetry(async () => {
    const memories = retrieveMemories(manager, "current threats opportunities goal");
    const faction = state.factions.find(f => f.id === manager.faction_id);
    const themeContext = theme ? `CONTEXT: The world genre is ${theme.genre} (${theme.tone}). Threats: ${theme.threat}.` : '';
    const toolContext = toolDb ? `SHARED TOOL ARCHIVE:\n${describeTools(toolDb)}\nUse execute_tool with tool_id and arguments.` : '';
    const recentEvents = (state.event_log || []).slice(-3).map(evt => `${evt.title}: ${evt.summary}`).join(' | ');
    const econSnapshot = (state.economy.commodities || []).slice(0, 3).map(c => `${c.id} ${c.current_price.toFixed(1)}G`).join(', ');
    const locationSnapshot = (state.map.locations || []).slice(0, 3).map(l => `${l.name} (Pros:${l.prosperity} Unrest:${l.unrest})`).join(', ');
    const factionSnapshot = faction ? `Resources G${faction.resources.gold}/Gr${faction.resources.grain}/Fe${faction.resources.iron}, Troops ${faction.military.troops}` : '';

    const prompt = `
      You are ${manager.name}, the ${manager.role} of ${faction?.name}.
      ${themeContext}
      FACTION STATUS: ${factionSnapshot}
      KEY LOCATIONS: ${locationSnapshot}
      MARKET: ${econSnapshot}
      RECENT EVENTS: ${recentEvents || 'None'}
      Goals: ${manager.goals.map(g => g.text).join(', ')}.
      ${toolContext}
      Task: Decide on a strategic move and spawn a sub-agent or invoke a shared tool.
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
      },
      {
        name: 'execute_tool',
        description: 'Use a shared tool from the Tool Archive.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            tool_id: { type: Type.STRING },
            arguments: { type: Type.OBJECT },
            note: { type: Type.STRING }
          },
          required: ['tool_id']
        }
      }
    ];

    const provider = getProviderConfig();
    let toolCalls: any[] = [];
    let chosenTool = "Wait";

    if (provider.providerId === 'gemini') {
      const ai = createAiClient();
      const response = await ai.models.generateContent({
        model: FLASH_MODEL,
        contents: prompt,
        config: {
          tools: [{ functionDeclarations: TOOLS }]
        }
      });

      const cand = response.candidates?.[0];
      const fc = cand?.content?.parts?.find(p => p.functionCall);
      toolCalls = fc ? [fc.functionCall] : [];
      chosenTool = fc ? fc.functionCall.name : "Wait";
    } else {
      const openAiTools: OpenAITool[] = [
        {
          type: 'function',
          function: {
            name: 'build_structure',
            description: 'Spawn BuilderAgent to construct a building.',
            parameters: {
              type: 'object',
              properties: {
                location_id: { type: 'string' },
                building_type: { type: 'string', enum: ['market', 'farm', 'barracks', 'wall'] },
                cost_gold: { type: 'number' },
                cost_grain: { type: 'number' }
              },
              required: ['location_id', 'building_type', 'cost_gold', 'cost_grain']
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'simulate_combat',
            description: 'Spawn TacticianAgent to manage combat.',
            parameters: {
              type: 'object',
              properties: {
                target_faction_id: { type: 'string' },
                location_id: { type: 'string' }
              },
              required: ['target_faction_id', 'location_id']
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'execute_tool',
            description: 'Use a shared tool from the Tool Archive.',
            parameters: {
              type: 'object',
              properties: {
                tool_id: { type: 'string' },
                arguments: { type: 'object' },
                note: { type: 'string' }
              },
              required: ['tool_id']
            }
          }
        }
      ];

      const message = await callOpenAIChat({
        messages: [
          { role: 'system', content: 'You are a strategic NPC manager in a world simulation.' },
          { role: 'user', content: prompt }
        ],
        tools: openAiTools
      });

      const parsedToolCalls = parseOpenAIToolCalls(message);
      toolCalls = parsedToolCalls.map(call => ({ name: call.name, args: call.args }));
      chosenTool = toolCalls[0]?.name || "Wait";
    }

    const trace: DecisionTrace = {
      decision_trace_id: `trace_${Date.now()}`,
      epoch: state.time.epoch,
      actor: manager.name,
      goal_summary: manager.goals.map(g => g.text),
      retrieved_memories: memories.map(m => ({ id: m.id, text: m.text, strength: m.strength })),
      world_facts_used: [`Day ${state.time.day}`],
      plan_candidates: [{ plan: "Action", pros: [], cons: [] }],
      chosen_plan: chosenTool,
      tool_calls: toolCalls.length ? [{ tool: toolCalls[0].name, inputs: toolCalls[0].args, outputs: null }] : [],
      world_diff_summary: [],
      confidence: 0.8
    };

    return { toolCalls, trace };
  });
};

export const runHistoryAgent = async (logs: string[]): Promise<string> => {
  return withRetry(async () => {
    const prompt = `Summarize these world events into a single punchy log entry: ${logs.join('; ')}`;
    const provider = getProviderConfig();
    if (provider.providerId === 'gemini') {
      const ai = createAiClient();
      const response = await ai.models.generateContent({ model: FLASH_MODEL, contents: prompt });
      return response.text || "Daily events concluded.";
    }

    const message = await callOpenAIChat({
      messages: [
        { role: 'system', content: 'You summarize events succinctly.' },
        { role: 'user', content: prompt }
      ]
    });
    return message.content || "Daily events concluded.";
  });
};

export const runWorldEventAgent = async (state: WorldState, theme?: ThemeConfig): Promise<{ title: string; summary: string; type: string } | null> => {
  return withRetry(async () => {
    const provider = getProviderConfig();
    const themeContext = theme ? `${theme.genre} (${theme.tone}) with threats like ${theme.threat}` : 'fantasy world';
    const prompt = `
      You are the world narrator for a strategy simulation.
      Create a short, punchy event entry (title + summary) for Day ${state.time.day}.
      World tone: ${themeContext}.
      Output strict JSON: {"title": "...", "summary": "...", "type": "world_event"}.
    `;

    if (provider.providerId === 'gemini') {
      const ai = createAiClient();
      const response = await ai.models.generateContent({
        model: FLASH_MODEL,
        contents: prompt,
        config: { responseMimeType: "application/json" }
      });
      const data = safeJsonParse(response.text || "{}", {});
      if (!data.title || !data.summary) return null;
      return { title: data.title, summary: data.summary, type: data.type || 'world_event' };
    }

    const message = await callOpenAIChat({
      messages: [
        { role: 'system', content: 'You output JSON only.' },
        { role: 'user', content: prompt }
      ],
      responseFormat: { type: 'json_object' }
    });
    const data = safeJsonParse(message.content || "{}", {});
    if (!data.title || !data.summary) return null;
    return { title: data.title, summary: data.summary, type: data.type || 'world_event' };
  });
};

export const runToolEvolutionAgent = async (state: WorldState, toolDb: ToolDB, theme?: ThemeConfig): Promise<AgentTool | null> => {
  return withRetry(async () => {
    const provider = getProviderConfig();
    const themeContext = theme ? `${theme.genre} (${theme.tone})` : 'fantasy';
    const toolList = describeTools(toolDb);
    const prompt = `
      You are designing shared strategic action templates for AI agents in a living world simulation.
      World: ${themeContext}. Day ${state.time.day}.
      Existing tools:\n${toolList}
      Create ONE new tool that is creative, useful, and grounded. Avoid duplicates.
      The tool should be a reusable action template, not a direct effect.
      Allowed parameter names (pick only those needed): target_id, target_type, location_id, faction_id, npc_id, building_type, target_faction_id, intensity, budget_gold, budget_grain.
      Output strict JSON:
      {
        "name":"",
        "description":"",
        "action_guidance":"",
        "parameters":[{"name":"","type":"string|number|boolean","description":""}],
        "cooldown_days": number,
        "lore":""
      }
    `;

    let data: any = null;
    if (provider.providerId === 'gemini') {
      const ai = createAiClient();
      const response = await ai.models.generateContent({
        model: FLASH_MODEL,
        contents: prompt,
        config: { responseMimeType: "application/json" }
      });
      data = safeJsonParse(response.text || "{}", null);
    } else {
      const message = await callOpenAIChat({
        messages: [
          { role: 'system', content: 'You output JSON only.' },
          { role: 'user', content: prompt }
        ],
        responseFormat: { type: 'json_object' }
      });
      data = safeJsonParse(message.content || "{}", null);
    }

    if (!data?.name || !data?.description || !data?.action_guidance) return null;
    return {
      id: `tool_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      name: data.name,
      description: data.description,
      action_guidance: data.action_guidance,
      parameters: Array.isArray(data.parameters) ? data.parameters.map((param: any) => ({
        name: param.name,
        type: param.type,
        description: param.description
      })) : [],
      cooldown_days: Number(data.cooldown_days) || 2,
      lore: data.lore || '',
      created_epoch: state.time.epoch
    } as AgentTool;
  });
};

export const runToolExecutionAgent = async (
  state: WorldState,
  manager: NPC,
  tool: AgentTool,
  args: Record<string, any>,
  theme?: ThemeConfig
): Promise<{ summary: string; calls: { tool: string; args: any }[] } | null> => {
  return withRetry(async () => {
    const provider = getProviderConfig();
    const themeContext = theme ? `${theme.genre} (${theme.tone})` : 'fantasy';
    const prompt = `
      You are executing a shared action template for a world simulation.
      World: ${themeContext}. Day ${state.time.day}.
      Actor: ${manager.name} (${manager.role}).
      Tool: ${tool.name}
      Description: ${tool.description}
      Guidance: ${tool.action_guidance}
      Parameters: ${JSON.stringify(tool.parameters)}
      Provided Arguments: ${JSON.stringify(args)}
      Return a concise summary and 1-3 tool calls.
      Allowed tool calls:
      - build_structure: {location_id, building_type (market|farm|barracks|wall), cost_gold, cost_grain}
      - simulate_combat: {target_faction_id, location_id}
      - apply_influence: {target_type (faction|location|npc), target_id, field, delta}
      Allowed fields for apply_influence:
      faction: resources.gold, resources.grain, resources.iron, military.troops, military.quality
      location: prosperity, defense, unrest, population
      npc: resources.gold, resources.influence
      Output strict JSON:
      {"summary":"", "calls":[{"tool":"", "args":{}}]}
    `;

    let data: any = null;
    if (provider.providerId === 'gemini') {
      const ai = createAiClient();
      const response = await ai.models.generateContent({
        model: FLASH_MODEL,
        contents: prompt,
        config: { responseMimeType: "application/json" }
      });
      data = safeJsonParse(response.text || "{}", null);
    } else {
      const message = await callOpenAIChat({
        messages: [
          { role: 'system', content: 'You output JSON only.' },
          { role: 'user', content: prompt }
        ],
        responseFormat: { type: 'json_object' }
      });
      data = safeJsonParse(message.content || "{}", null);
    }

    if (!data?.calls || !Array.isArray(data.calls)) return null;
    return {
      summary: data.summary || `${tool.name} executed`,
      calls: data.calls.map((call: any) => ({ tool: call.tool, args: call.args || {} }))
    };
  });
};

export const generateCharacterPortrait = async (npc: NPC, factionName: string, theme?: ThemeConfig): Promise<string | null> => {
  return withRetry(async () => {
    const provider = getProviderConfig();
    if (provider.providerId !== 'gemini') return null;
    const ai = createAiClient();
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
    const prompt = `You are ${npc.name}, a ${npc.role} in ${factionName}. Respond in character. Concisely.`;
    const provider = getProviderConfig();
    if (provider.providerId === 'gemini') {
      const ai = createAiClient();
      const chatHistory = history.map(h => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.text }] }));
      const chat = ai.chats.create({ model: FLASH_MODEL, config: { systemInstruction: prompt }, history: chatHistory as any });
      const result = await chat.sendMessage({ message: userMessage });
      return result.text || "...";
    }

    const messages: OpenAIMessage[] = [
      { role: 'system', content: prompt },
      ...history.map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.text })),
      { role: 'user', content: userMessage }
    ];
    const message = await callOpenAIChat({ messages });
    return message.content || "...";
  });
};

export const generateSpeech = async (text: string, voiceName: string = 'Kore'): Promise<string | null> => {
  return withRetry(async () => {
    const provider = getProviderConfig();
    if (provider.providerId !== 'gemini') return null;
    const ai = createAiClient();
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
