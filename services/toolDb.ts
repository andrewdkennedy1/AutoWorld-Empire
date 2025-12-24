import type { WorldState } from '../types';

export type ToolParameter = {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
};

export type AgentTool = {
  id: string;
  name: string;
  description: string;
  action_guidance: string;
  parameters: ToolParameter[];
  cooldown_days: number;
  lore?: string;
  created_epoch?: number;
};

export type ToolDB = {
  tools: AgentTool[];
  usage: Record<string, number>;
  last_evolved_epoch?: number;
};

const TOOL_DB_STORAGE_KEY = 'auto_world_tool_db_v1';
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const loadToolDb = (): ToolDB => {
  if (typeof window === 'undefined') return { tools: [], usage: {} };
  const raw = localStorage.getItem(TOOL_DB_STORAGE_KEY);
  if (!raw) return { tools: [], usage: {} };
  try {
    const parsed = JSON.parse(raw) as ToolDB;
    const tools = Array.isArray(parsed.tools)
      ? parsed.tools
          .filter((tool: any) => tool?.name && tool?.description && tool?.action_guidance)
          .map((tool: any) => ({
            ...tool,
            parameters: Array.isArray(tool.parameters) ? tool.parameters : []
          }))
      : [];
    return {
      tools,
      usage: parsed.usage || {},
      last_evolved_epoch: parsed.last_evolved_epoch
    };
  } catch {
    return { tools: [], usage: {} };
  }
};

export const saveToolDb = (db: ToolDB) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TOOL_DB_STORAGE_KEY, JSON.stringify(db));
};

export const validateTool = (tool: AgentTool) => {
  if (!tool.name || !tool.description || !tool.action_guidance) return false;
  if (!Array.isArray(tool.parameters)) return false;
  return true;
};

export const normalizeTool = (tool: AgentTool) => {
  return {
    ...tool,
    cooldown_days: clamp(tool.cooldown_days || 1, 1, 10)
  };
};

export const addTool = (db: ToolDB, tool: AgentTool) => {
  if (!validateTool(tool)) return db;
  const normalized = normalizeTool(tool);
  if (db.tools.some(t => t.name.toLowerCase() === normalized.name.toLowerCase())) return db;
  return {
    ...db,
    tools: [...db.tools, normalized]
  };
};

export const getToolById = (db: ToolDB, id: string) => db.tools.find(t => t.id === id) || null;

export const markToolUsed = (db: ToolDB, toolId: string, epoch: number) => {
  return {
    ...db,
    usage: { ...db.usage, [toolId]: epoch }
  };
};

export const canUseTool = (db: ToolDB, toolId: string, world: WorldState) => {
  const tool = getToolById(db, toolId);
  if (!tool) return false;
  const lastUsed = db.usage[toolId];
  if (!lastUsed) return true;
  return world.time.epoch - lastUsed >= tool.cooldown_days;
};

export const describeTools = (db: ToolDB) => {
  if (db.tools.length === 0) return 'No shared tools yet.';
  return db.tools
    .map(tool => {
      const params = tool.parameters.length
        ? tool.parameters.map(param => `${param.name}:${param.type}`).join(', ')
        : 'none';
      return `${tool.id}: ${tool.name} - ${tool.description} | params: ${params} | guidance: ${tool.action_guidance}`;
    })
    .join('\n');
};
