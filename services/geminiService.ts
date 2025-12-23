import { GoogleGenAI, FunctionDeclaration, Type, Schema, GenerateContentResponse } from "@google/genai";
import { WorldState, NPC, WorldEvent, DecisionTrace, CustomTool } from '../types';
import { executeScout, executeTrade, executeRumor, executeCombatOps } from './toolService';
import { retrieveRelevantMemories } from './memoryService';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const REASONING_MODEL = 'gemini-3-pro-preview'; 
const IMAGE_MODEL = 'gemini-3-pro-image-preview';
const SIMULATION_MODEL = 'gemini-3-pro-preview'; // Used to simulate dynamic tools

// Static Tools
const STATIC_TOOLS: FunctionDeclaration[] = [
  {
    name: 'deployScout',
    description: 'Deploys a scout sub-agent to gather info.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        location: { type: Type.STRING, description: 'Location to scout (e.g., Forest, Market, Town Hall)' }
      },
      required: ['location']
    }
  },
  {
    name: 'manageEconomy',
    description: 'Deploys a merchant sub-agent to influence the market.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, enum: ['BUY', 'SELL', 'HOARD'], description: 'Economic action to take' }
      },
      required: ['action']
    }
  },
  {
    name: 'spreadRumor',
    description: 'Deploys a rumor sub-agent to influence public opinion.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        targetFaction: { type: Type.STRING, description: 'Faction to talk about' },
        type: { type: Type.STRING, enum: ['SLANDER', 'PRAISE'], description: 'Type of rumor' }
      },
      required: ['targetFaction', 'type']
    }
  },
  {
    name: 'executeCombat',
    description: 'Deploys a tactician sub-agent for combat or security.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        operation: { type: Type.STRING, enum: ['RAID', 'PATROL'], description: 'Combat operation type' }
      },
      required: ['operation']
    }
  },
  {
    name: 'inventTool',
    description: 'Invents a NEW tool/capability that can be used by ANY agent in the future. Use this when existing tools are insufficient.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: 'Name of the tool (camelCase, e.g., performRitual)' },
        description: { type: Type.STRING, description: 'Detailed description of what the tool does and its effect on the world.' },
        parameterJsonSchema: { type: Type.STRING, description: 'Stringified JSON Schema for the tool parameters.' }
      },
      required: ['name', 'description', 'parameterJsonSchema']
    }
  }
];

// Helper to simulate the effect of a dynamically invented tool
async function simulateDynamicTool(
  state: WorldState,
  toolName: string,
  toolDesc: string,
  args: any,
  agent: NPC
): Promise<{ message: string; updates: any }> {
  
  const prompt = `
    You are the World Engine. An agent has invoked a custom tool.
    
    TOOL NAME: ${toolName}
    DESCRIPTION: ${toolDesc}
    ARGS USED: ${JSON.stringify(args)}
    
    AGENT: ${agent.name} (${agent.role})
    CURRENT STATE: 
    - Grain: ${state.resources.grainStock}
    - Price: ${state.resources.grainPrice}
    - Security: ${state.resources.securityLevel}
    - Unrest: ${state.resources.unrest}
    
    TASK:
    Determine the outcome of this action.
    Return a JSON object with:
    1. "message": A text description of what happened.
    2. "updates": A partial JSON object of the WorldState (resources, etc) that changed.
    
    Be creative but realistic.
  `;

  try {
    const response = await ai.models.generateContent({
      model: SIMULATION_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            message: { type: Type.STRING },
            updates: { 
              type: Type.OBJECT,
              properties: {
                resources: {
                   type: Type.OBJECT,
                   properties: {
                     grainPrice: { type: Type.NUMBER },
                     grainStock: { type: Type.NUMBER },
                     securityLevel: { type: Type.NUMBER },
                     unrest: { type: Type.NUMBER }
                   }
                }
              }
            }
          }
        }
      }
    });
    
    const result = JSON.parse(response.text || "{}");
    return {
      message: result.message || `Executed ${toolName}.`,
      updates: result.updates || {}
    };
  } catch (e) {
    console.error("Dynamic tool simulation failed", e);
    return { message: `Attempted ${toolName} but failed.`, updates: {} };
  }
}

// Helper to generate narrative and visuals
async function generateNarrativeAndVisuals(
  npc: NPC, 
  actionDescription: string, 
  resultMessage: string, 
  imageSize: '1K' | '2K' | '4K'
): Promise<{ narrative: string; imageUrl?: string }> {
  
  const narrativePrompt = `
    Context: Fantasy RPG World.
    Character: ${npc.name} (${npc.role}, ${npc.faction}).
    Appearance: ${npc.appearance}.
    Action Taken: ${actionDescription}.
    Result: ${resultMessage}.
    
    Task 1: Write a short, dramatic narrative paragraph (max 3 sentences) describing this scene in the past tense.
    Task 2: Write a detailed image generation prompt for this scene.
    
    Return JSON: { "narrative": string, "imagePrompt": string }
  `;

  let narrativeText = resultMessage;
  let imageUrl: string | undefined;

  try {
    const narrativeResponse = await ai.models.generateContent({
      model: REASONING_MODEL,
      contents: narrativePrompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            narrative: { type: Type.STRING },
            imagePrompt: { type: Type.STRING }
          }
        }
      }
    });

    const json = JSON.parse(narrativeResponse.text || "{}");
    narrativeText = json.narrative || resultMessage;
    const imagePrompt = json.imagePrompt;

    if (imagePrompt) {
      const imageResponse = await ai.models.generateContent({
        model: IMAGE_MODEL,
        contents: { parts: [{ text: imagePrompt }] },
        config: {
          imageConfig: {
            aspectRatio: "16:9",
            imageSize: imageSize
          }
        }
      });

      for (const part of imageResponse.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
          break;
        }
      }
    }

  } catch (e) {
    console.warn("Failed to generate narrative/image", e);
  }

  return { narrative: narrativeText, imageUrl };
}

export const runAgentTurn = async (
  npc: NPC,
  currentState: WorldState,
  imageSize: '1K' | '2K' | '4K'
): Promise<{ event: WorldEvent; updates: Partial<WorldState> | null; newMemories: { npcId: string; memory: string }[]; newTool?: CustomTool }> => {
  
  // 1. Context Construction
  const memories = retrieveRelevantMemories(npc, `current situation grain bandits town`);
  
  // Combine Static Tools with Dynamically Invented Tools
  const dynamicTools: FunctionDeclaration[] = currentState.customTools.map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters
  }));
  
  const ALL_TOOLS = [...STATIC_TOOLS, ...dynamicTools];

  const prompt = `
    You are ${npc.name}, the ${npc.role} of the ${npc.faction}.
    Appearance: ${npc.appearance}
    
    YOUR GOALS: ${npc.goals.join(', ')}.
    YOUR RELATIONSHIPS: ${JSON.stringify(npc.relationships)}.
    
    WORLD STATE:
    - Grain Price: ${currentState.resources.grainPrice}
    - Security: ${currentState.resources.securityLevel}
    - Unrest: ${currentState.resources.unrest}
    - Day: ${currentState.day}
    - AVAILABLE TOOLS: ${ALL_TOOLS.map(t => t.name).join(', ')}
    
    RECENT MEMORIES:
    ${memories.join('\n')}
    
    TASK:
    Analyze the situation carefully using Thinking Mode.
    Decide on a SINGLE strategic move.
    
    Options:
    1. Use an existing tool (Scout, Trade, Combat, etc).
    2. INVENT A NEW TOOL if you need a specific capability not listed (e.g., assassinate, bribe, magical_ritual, fortify).
    3. Use a previously invented tool if relevant.
    
    If you invent a tool, provide a generic schema so others can use it too.
  `;

  try {
    const response = await ai.models.generateContent({
      model: REASONING_MODEL,
      contents: prompt,
      config: {
        tools: [{ functionDeclarations: ALL_TOOLS }],
        thinkingConfig: { thinkingBudget: 32768 }
      }
    });

    const candidate = response.candidates?.[0];
    const fc = candidate?.content?.parts?.find(p => p.functionCall);
    const reasoningText = candidate?.content?.parts?.find(p => p.text)?.text || "Deep thought process engaged...";

    const trace: DecisionTrace = {
      agentName: npc.name,
      goal: npc.goals[0],
      retrievedMemories: memories,
      reasoning: reasoningText,
      toolUsed: 'None',
      toolInput: {},
      toolOutput: {},
      stateDiff: 'No Action',
      isThinking: true
    };

    if (fc && fc.functionCall) {
      const name = fc.functionCall.name;
      const args = fc.functionCall.args as any;

      trace.toolUsed = name;
      trace.toolInput = args;

      // Special Handling for InventTool
      if (name === 'inventTool') {
         const newTool: CustomTool = {
           name: args.name,
           description: args.description,
           parameters: JSON.parse(args.parameterJsonSchema || "{}"),
           creatorId: npc.id,
           createdTick: currentState.tick
         };
         
         trace.toolOutput = { success: true, message: `Invented new tool: ${args.name}` };
         trace.stateDiff = "New capability added to global registry.";
         
         const { narrative, imageUrl } = await generateNarrativeAndVisuals(npc, `invented a new technique: ${args.name}`, `The world now allows: ${args.description}`, imageSize);

         return {
           event: {
             id: crypto.randomUUID(),
             tick: currentState.tick,
             type: 'TOOL_INVENTION',
             description: `${npc.name} invented a new tool: ${args.name}`,
             narrative,
             imageUrl,
             sourceId: npc.id,
             trace,
             impact: 'New Capability Available'
           },
           updates: null,
           newMemories: [{ npcId: npc.id, memory: `I invented the ${args.name} technique on day ${currentState.day}.` }],
           newTool: newTool
         };
      }

      // Execution Logic
      let result;
      // Check if it's a static tool
      if (['deployScout', 'manageEconomy', 'spreadRumor', 'executeCombat'].includes(name)) {
        switch (name) {
          case 'deployScout': result = executeScout(currentState, npc.id, args.location); break;
          case 'manageEconomy': result = executeTrade(currentState, npc.id, args.action); break;
          case 'spreadRumor': result = executeRumor(currentState, npc.id, args.targetFaction, args.type); break;
          case 'executeCombat': result = executeCombatOps(currentState, npc.id, args.operation); break;
        }
      } else {
        // It's a Dynamic Tool!
        const toolDef = currentState.customTools.find(t => t.name === name);
        if (toolDef) {
           const simResult = await simulateDynamicTool(currentState, name, toolDef.description, args, npc);
           result = {
             success: true,
             message: simResult.message,
             updates: simResult.updates,
             newMemories: [{ npcId: npc.id, memory: `Used custom tool ${name}. Result: ${simResult.message}` }]
           };
        } else {
           throw new Error(`Tool ${name} not found in static or dynamic registry.`);
        }
      }

      if (!result) throw new Error("Result undefined");

      trace.toolOutput = { success: result.success, message: result.message };
      trace.stateDiff = JSON.stringify(result.updates || {});

      const { narrative, imageUrl } = await generateNarrativeAndVisuals(npc, trace.reasoning, result.message, imageSize);

      return {
        event: {
          id: crypto.randomUUID(),
          tick: currentState.tick,
          type: 'AGENT_ACTION',
          description: result.message,
          narrative: narrative,
          imageUrl: imageUrl,
          sourceId: npc.id,
          trace: trace,
          impact: result.updates ? 'World State Changed' : 'Information Gathered'
        },
        updates: result.updates,
        newMemories: result.newMemories || []
      };

    } else {
      // Fallback
      const { narrative, imageUrl } = await generateNarrativeAndVisuals(npc, "Contemplation", `${npc.name} thought deeply but took no action.`, imageSize);

      return {
        event: {
          id: crypto.randomUUID(),
          tick: currentState.tick,
          type: 'AGENT_ACTION',
          description: `${npc.name} deliberated but took no direct action.`,
          narrative: narrative,
          imageUrl: imageUrl,
          sourceId: npc.id,
          trace: { ...trace, reasoning: response.text || "Thinking..." }
        },
        updates: null,
        newMemories: []
      };
    }
  } catch (error) {
    console.error("Gemini Agent Error:", error);
    return {
      event: {
        id: crypto.randomUUID(),
        tick: currentState.tick,
        type: 'AGENT_ACTION',
        description: `${npc.name} failed to formulate a plan.`,
        sourceId: npc.id
      },
      updates: null,
      newMemories: []
    };
  }
};