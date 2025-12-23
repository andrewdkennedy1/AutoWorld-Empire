import { Memory, NPC } from '../types';

export const DECAY_RATE = 5; // Points lost per day
export const MAX_MEMORY_STRENGTH = 100;
export const MEMORY_RETRIEVAL_LIMIT = 5;

// Decay memory strength over time
export const decayMemories = (npcs: NPC[]): NPC[] => {
  return npcs.map(npc => ({
    ...npc,
    memories: npc.memories
      .map(mem => ({ ...mem, strength: mem.strength - DECAY_RATE }))
      .filter(mem => mem.strength > 0) // Remove forgotten memories
  }));
};

// Add a new memory
export const addMemory = (npc: NPC, description: string, tick: number): NPC => {
  const newMemory: Memory = {
    id: crypto.randomUUID(),
    description,
    timestamp: tick,
    strength: MAX_MEMORY_STRENGTH,
    tags: [],
    involvedIds: []
  };
  return {
    ...npc,
    memories: [newMemory, ...npc.memories] // Newest first
  };
};

// Semantic-ish retrieval (simple keyword matching for demo purposes)
// In a real app, this would use embeddings.
export const retrieveRelevantMemories = (npc: NPC, context: string): string[] => {
  const contextLower = context.toLowerCase();
  
  // Sort by relevance (keyword match) + strength
  const sorted = [...npc.memories].sort((a, b) => {
    const aMatch = contextLower.split(' ').filter(w => a.description.toLowerCase().includes(w)).length;
    const bMatch = contextLower.split(' ').filter(w => b.description.toLowerCase().includes(w)).length;
    
    // Weight matches heavily, then strength
    const scoreA = (aMatch * 50) + a.strength;
    const scoreB = (bMatch * 50) + b.strength;
    
    return scoreB - scoreA;
  });

  return sorted.slice(0, MEMORY_RETRIEVAL_LIMIT).map(m => `[Strength: ${m.strength}] ${m.description}`);
};