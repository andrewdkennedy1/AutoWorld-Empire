import { NPC, MemoryItem } from '../types';

export const updateMemoryStrengths = (
  npcs: NPC[],
  dailyDecayMultiplier: number
): NPC[] => {
  return npcs.map(npc => ({
    ...npc,
    memory: npc.memory
      .map(m => ({
        ...m,
        strength: parseFloat((m.strength * dailyDecayMultiplier).toFixed(3))
      }))
      .filter(m => m.strength > 0.1) // Prune weak memories
  }));
};

export const addMemoryToNPC = (npc: NPC, text: string, epoch: number, tags: string[] = []): NPC => {
  const newMem: MemoryItem = {
    id: `mem_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    text,
    tags,
    strength: 1.0,
    created_epoch: epoch,
    last_reinforced_epoch: epoch
  };
  return { ...npc, memory: [newMem, ...npc.memory] };
};

export const retrieveMemories = (npc: NPC, query: string, limit: number = 3): MemoryItem[] => {
  // Simple keyword matching for demo (MVP)
  // In full prod, use embeddings.
  const queryTokens = query.toLowerCase().split(' ');
  
  return [...npc.memory]
    .map(m => {
      let score = m.strength;
      const text = m.text.toLowerCase();
      queryTokens.forEach(t => {
        if (text.includes(t)) score += 0.5;
      });
      return { m, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.m);
};