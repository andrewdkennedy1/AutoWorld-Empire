import React, { useState, useEffect, useRef } from 'react';
import { INITIAL_STATE } from './constants';
import { WorldState, WorldEvent, AgentRole } from './types';
import { runAgentTurn } from './services/geminiService';
import { decayMemories, addMemory } from './services/memoryService';
import { Card, Badge, Button, TraceModal } from './components/UIComponents';

type ImageSize = '1K' | '2K' | '4K';

const STORAGE_KEY = 'realm_forge_save_v1';

const App = () => {
  // Initialize state function to check localStorage first
  const [worldState, setWorldState] = useState<WorldState>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : INITIAL_STATE;
  });
  
  const [processing, setProcessing] = useState(false);
  const [selectedTrace, setSelectedTrace] = useState<any>(null);
  const [autoRun, setAutoRun] = useState(false);
  const [imageSize, setImageSize] = useState<ImageSize>('1K');
  
  const processingRef = useRef(processing);
  processingRef.current = processing;
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Persistence Effect
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(worldState));
  }, [worldState]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [worldState.events, worldState.logs]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (autoRun) {
      interval = setInterval(() => {
        if (!processingRef.current) {
          handleAdvanceTime();
        }
      }, 5000);
    }
    return () => clearInterval(interval);
  }, [autoRun]);

  const resetWorld = () => {
    localStorage.removeItem(STORAGE_KEY);
    setWorldState(INITIAL_STATE);
    setAutoRun(false);
  };

  const addLog = (msg: string) => {
    setWorldState(prev => ({ ...prev, logs: [...prev.logs, `[Day ${prev.day}] ${msg}`] }));
  };

  const handleAdvanceTime = async () => {
    if (processing) return;
    setProcessing(true);
    addLog("--- WorldSleepEvent: Cycle Start ---");

    const decayedNPCs = decayMemories(worldState.npcs);
    let nextState = { ...worldState, npcs: decayedNPCs };

    const managers = nextState.npcs.filter(n => 
      [AgentRole.MAYOR, AgentRole.MERCHANT_LEADER, AgentRole.BANDIT_LEADER].includes(n.role)
    );

    const turnEvents: WorldEvent[] = [];
    const memoryUpdates: { npcId: string, memory: string }[] = [];
    const newTools: any[] = [];

    for (const manager of managers) {
      addLog(`${manager.name} (${manager.role}) is planning...`);
      // Agents can now see current customTools and potentially add new ones
      const result = await runAgentTurn(manager, nextState, imageSize);
      
      turnEvents.push(result.event);
      if (result.updates) {
        if (result.updates.resources) {
          nextState.resources = { ...nextState.resources, ...result.updates.resources };
        }
      }
      if (result.newMemories) {
        memoryUpdates.push(...result.newMemories);
      }
      if (result.newTool) {
        // Add the new tool to the state immediately so subsequent agents *might* technically see it if we updated nextState reference
        // But for this turn loop, we'll append at end to avoid mid-loop state mutation issues
        newTools.push(result.newTool);
        addLog(`*** NEW TOOL INVENTED: ${result.newTool.name} ***`);
      }
    }

    // Apply new tools
    if (newTools.length > 0) {
      nextState.customTools = [...nextState.customTools, ...newTools];
    }

    // Update NPC Memories
    nextState.npcs = nextState.npcs.map(npc => {
      let updatedNpc = { ...npc };
      memoryUpdates.filter(m => m.npcId === npc.id).forEach(m => {
        updatedNpc = addMemory(updatedNpc, m.memory, nextState.tick);
      });
      turnEvents.forEach(evt => {
        if (evt.impact && evt.sourceId !== npc.id) {
           updatedNpc = addMemory(updatedNpc, `Witnessed event: ${evt.description}`, nextState.tick);
        }
      });
      return updatedNpc;
    });

    nextState.tick += 1;
    nextState.day += 1;
    nextState.events = [...nextState.events, ...turnEvents];
    
    setWorldState(nextState);
    addLog("--- WorldSleepEvent: Cycle Complete ---");
    setProcessing(false);
  };

  return (
    <div className="min-h-screen bg-realm-dark text-realm-text font-sans p-4 md:p-8">
      {/* Header */}
      <header className="flex flex-col xl:flex-row justify-between items-center mb-8 border-b border-realm-muted/30 pb-4">
        <div className="mb-4 xl:mb-0">
          <h1 className="text-3xl font-bold text-white tracking-tight">
            Realm<span className="text-realm-accent">Forge</span>
          </h1>
          <p className="text-realm-muted text-sm mt-1">
            Gemini 3 Orchestrated Living Sandbox + Persistent Memory
          </p>
        </div>
        <div className="flex flex-col md:flex-row gap-4 items-center">
          
          <div className="flex items-center gap-2 bg-realm-panel rounded-lg p-1 border border-realm-muted/30">
            <span className="text-xs text-realm-muted px-2">Image:</span>
            {['1K', '2K', '4K'].map((size) => (
              <button
                key={size}
                onClick={() => setImageSize(size as ImageSize)}
                className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                  imageSize === size 
                    ? 'bg-realm-accent text-realm-dark' 
                    : 'text-realm-muted hover:text-white'
                }`}
              >
                {size}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
             <Button variant="secondary" onClick={() => setAutoRun(!autoRun)}>
              {autoRun ? '⏹ Stop Demo' : '▶ Start Demo Mode'}
            </Button>
            <Button 
              onClick={handleAdvanceTime} 
              disabled={processing}
              variant="primary"
            >
              {processing ? 'Thinking...' : 'Advance Time (24h)'}
            </Button>
            <Button variant="danger" onClick={resetWorld}>
              Reset
            </Button>
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-160px)]">
        
        {/* Left Column: World Stats & Map Placeholder */}
        <div className="lg:col-span-3 flex flex-col gap-6">
          <Card title="World State">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span>Day</span>
                <span className="text-white font-mono text-xl">{worldState.day}</span>
              </div>
              <hr className="border-realm-muted/30"/>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Grain Price</span>
                  <span className={worldState.resources.grainPrice > 15 ? 'text-realm-danger' : 'text-realm-success'}>
                    {worldState.resources.grainPrice} gold
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Stock</span>
                  <span>{worldState.resources.grainStock} units</span>
                </div>
                <div className="flex justify-between">
                  <span>Security</span>
                  <div className="w-24 h-2 bg-realm-dark rounded overflow-hidden mt-1.5">
                    <div 
                      className="h-full bg-blue-500" 
                      style={{ width: `${worldState.resources.securityLevel}%` }} 
                    />
                  </div>
                </div>
                <div className="flex justify-between">
                  <span>Unrest</span>
                  <div className="w-24 h-2 bg-realm-dark rounded overflow-hidden mt-1.5">
                    <div 
                      className="h-full bg-red-500" 
                      style={{ width: `${worldState.resources.unrest}%` }} 
                    />
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <Card title="Knowledge Registry (Tools)" className="flex-1 overflow-y-auto max-h-60">
             <p className="text-xs text-realm-muted mb-2">Capabilities invented by AI agents.</p>
             <div className="space-y-2">
                {worldState.customTools.length === 0 && (
                   <div className="text-xs text-gray-600 italic">No custom tools invented yet.</div>
                )}
                {worldState.customTools.map((tool, i) => (
                  <div key={i} className="p-2 bg-teal-900/20 border border-teal-500/30 rounded">
                    <div className="flex justify-between">
                       <span className="text-teal-400 font-bold text-xs">{tool.name}</span>
                       <span className="text-[10px] text-realm-muted">Day {Math.floor(tool.createdTick)}</span>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1 line-clamp-2">{tool.description}</p>
                  </div>
                ))}
             </div>
          </Card>

          <Card title="Factions" className="flex-1 overflow-y-auto">
            <div className="space-y-4">
              {[
                { name: 'Town Council', color: 'text-blue-400', desc: 'Seeking order.' },
                { name: 'Merchants Guild', color: 'text-yellow-400', desc: 'Seeking profit.' },
                { name: 'Forest Bandits', color: 'text-red-400', desc: 'Seeking chaos.' },
              ].map(f => (
                <div key={f.name} className="p-3 bg-black/20 rounded border border-realm-muted/10">
                  <h4 className={`font-bold ${f.color}`}>{f.name}</h4>
                  <p className="text-xs text-realm-muted">{f.desc}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Center Column: Event Feed */}
        <div className="lg:col-span-5 flex flex-col gap-4 h-full">
          <Card title="Event Feed" className="flex-1 flex flex-col min-h-0">
            <div className="overflow-y-auto pr-2 space-y-3 flex-1">
               {worldState.events.length === 0 && (
                 <div className="text-center text-realm-muted mt-10">
                   No events yet. Advance time to start simulation.
                 </div>
               )}
               {[...worldState.events].reverse().map((evt) => {
                 const isReasoning = evt.trace?.isThinking;
                 const isInvention = evt.type === 'TOOL_INVENTION';
                 
                 let borderColor = 'border-realm-accent';
                 let bgColor = 'bg-black/20';
                 
                 if (isReasoning) {
                   borderColor = 'border-purple-500';
                   bgColor = 'bg-purple-900/20';
                 }
                 if (isInvention) {
                   borderColor = 'border-teal-500';
                   bgColor = 'bg-teal-900/20';
                 }

                 return (
                  <div 
                    key={evt.id} 
                    className={`p-4 rounded border-l-4 transition-colors ${bgColor} ${borderColor} hover:bg-opacity-40`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-xs text-realm-muted uppercase tracking-wider">Tick {evt.tick}</span>
                      {evt.trace && (
                        <div className="flex items-center gap-3">
                          {isInvention && (
                             <span className="flex items-center gap-1 text-[10px] uppercase font-bold text-teal-400 border border-teal-500/50 px-1.5 py-0.5 rounded bg-teal-500/10">
                              🚀 Discovery
                            </span>
                          )}
                          {isReasoning && !isInvention && (
                            <span className="flex items-center gap-1 text-[10px] uppercase font-bold text-purple-400 border border-purple-500/50 px-1.5 py-0.5 rounded bg-purple-500/10">
                              <span className="animate-pulse">✨</span> Reasoning
                            </span>
                          )}
                          <button 
                            onClick={() => setSelectedTrace(evt.trace)}
                            className="text-xs text-realm-accent hover:underline flex items-center gap-1"
                          >
                            <span className="text-lg">🔍</span> Trace
                          </button>
                        </div>
                      )}
                    </div>
                    
                    {/* Narrative or Description */}
                    <p className={`text-sm ${isReasoning ? 'text-white font-medium' : 'text-white'}`}>
                      {evt.narrative || evt.description}
                    </p>

                    {/* Image Attachment */}
                    {evt.imageUrl && (
                      <div className="mt-3 rounded-lg overflow-hidden border border-realm-muted/30 relative group">
                        <img 
                          src={evt.imageUrl} 
                          alt="AI Generated Visualization" 
                          className="w-full h-auto object-cover max-h-48 opacity-90 group-hover:opacity-100 transition-opacity"
                        />
                        <div className="absolute bottom-1 right-1 bg-black/60 px-1.5 py-0.5 rounded text-[10px] text-white backdrop-blur-sm">
                          Gemini 3 Pro Image
                        </div>
                      </div>
                    )}

                    {evt.impact && (
                      <div className="mt-2 text-xs text-realm-success font-mono">
                        &gt; {evt.impact}
                      </div>
                    )}
                 </div>
               )})}
            </div>
          </Card>
          
          <div className="h-32 bg-black font-mono text-xs p-2 overflow-y-auto text-green-400 rounded border border-realm-muted/30">
            {worldState.logs.map((log, i) => (
              <div key={i}>{log}</div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>

        {/* Right Column: Agents */}
        <div className="lg:col-span-4 flex flex-col h-full min-h-0">
          <Card title="Active Agents" className="h-full flex flex-col min-h-0">
            <div className="overflow-y-auto pr-2 space-y-3 flex-1">
              {worldState.npcs.map(npc => (
                <div key={npc.id} className="p-3 bg-realm-dark/50 rounded border border-realm-muted/20">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-bold text-white text-sm">{npc.name}</h4>
                      <p className="text-xs text-realm-muted">{npc.role}</p>
                    </div>
                    <Badge 
                      text={npc.faction.split(' ')[0]} 
                      type={
                        npc.faction.includes('Bandit') ? 'danger' : 
                        npc.faction.includes('Merchant') ? 'warning' : 'neutral'
                      } 
                    />
                  </div>
                  <div className="mt-2 text-xs space-y-1">
                    <div className="flex justify-between">
                      <span className="text-realm-muted">Status:</span>
                      <span className="text-realm-accent">{npc.status}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-realm-muted">Memories:</span>
                      <span>{npc.memories.length} stored</span>
                    </div>
                    <div className="mt-1 pt-1 border-t border-realm-muted/20">
                      <span className="text-realm-muted block mb-1">Current Goal:</span>
                      <span className="text-gray-300 italic">"{npc.goals[0]}"</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* Modal for Decision Trace */}
      {selectedTrace && (
        <TraceModal trace={selectedTrace} onClose={() => setSelectedTrace(null)} />
      )}
    </div>
  );
};

export default App;