import React, { useState, useEffect, useRef } from 'react';
import { EMPTY_STATE, INITIAL_BUNDLE } from './constants';
import { WorldBundle, WorldState, DecisionTrace, ThemeConfig, Tile, NPC } from './types';
import { runGenesisAgent, runManagerAgent, runHistoryAgent } from './services/geminiService';
import { buildStructure, simulateEconomy, generateWorldDiff } from './services/toolService';
import { resolveCombatConflict } from './services/godEngine';
import { updateMemoryStrengths } from './services/memoryService';
import { Card, Button, WorldMap, TraceModal, SetupModal, GenesisLoading, TileInspector, NPCChatModal } from './components/UIComponents';

const App = () => {
  const [bundle, setBundle] = useState<WorldBundle>(() => {
    const saved = localStorage.getItem('auto_world_v1');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Robust hydration to ensure all arrays exist even in old saves
        return {
          ...INITIAL_BUNDLE,
          ...parsed,
          world_state: {
            ...INITIAL_BUNDLE.world_state,
            ...(parsed.world_state || {}),
            map: {
              ...INITIAL_BUNDLE.world_state.map,
              ...(parsed.world_state?.map || {}),
              tiles: parsed.world_state?.map?.tiles || [],
              locations: parsed.world_state?.map?.locations || [],
              routes: parsed.world_state?.map?.routes || [],
            },
            factions: parsed.world_state?.factions || [],
            npcs: parsed.world_state?.npcs || [],
            economy: {
              ...INITIAL_BUNDLE.world_state.economy,
              ...(parsed.world_state?.economy || {}),
              commodities: parsed.world_state?.economy?.commodities || [],
              market_events: parsed.world_state?.economy?.market_events || [],
            },
            quests: parsed.world_state?.quests || [],
            event_log: parsed.world_state?.event_log || [],
            decision_traces: parsed.world_state?.decision_traces || []
          }
        };
      } catch (e) {
        console.error("Failed to load save", e);
        return INITIAL_BUNDLE;
      }
    }
    return INITIAL_BUNDLE;
  });

  const [processing, setProcessing] = useState(false);
  const [selectedTrace, setSelectedTrace] = useState<DecisionTrace | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  
  // Interaction State
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [selectedNPC, setSelectedNPC] = useState<NPC | null>(null);

  // Persistence
  useEffect(() => {
    localStorage.setItem('auto_world_v1', JSON.stringify(bundle));
  }, [bundle]);

  // Demo Mode Script
  useEffect(() => {
    if (demoMode && !processing) {
      if (bundle.world_state.time.day === 1) {
        handleAdvanceTime(); // Advance to Day 2
      } else if (bundle.world_state.time.day === 2) {
        handleAdvanceTime(); // Advance to Day 3
      } else {
        setDemoMode(false); // Stop after Day 3
        // Auto-open last trace
        const traces = bundle.world_state.decision_traces || [];
        const lastTrace = traces.length > 0 ? traces[traces.length - 1] : null;
        if (lastTrace) setSelectedTrace(lastTrace);
      }
    }
  }, [demoMode, processing, bundle.world_state.time.day]);

  const handleGenesis = async (theme: ThemeConfig) => {
    setProcessing(true);
    setShowSetup(false);
    try {
      const generatedData = await runGenesisAgent(Date.now().toString(), theme);
      const newState: WorldState = {
        ...EMPTY_STATE,
        ...generatedData as any,
        time: { day: 1, hour: 8, epoch: 1 }
      };
      setBundle({ 
        ...bundle, 
        world_state: newState, 
        world_diffs: [],
        meta: { ...bundle.meta, themeConfig: theme, world_name: `Realm of ${theme.genre}` } 
      });
    } catch (e) {
      console.error(e);
      alert("Genesis failed. Try again.");
    }
    setProcessing(false);
  };

  const handleAdvanceTime = async () => {
    if (processing) return;
    setProcessing(true);
    
    const prevState = JSON.parse(JSON.stringify(bundle.world_state));
    let nextState = { ...bundle.world_state };
    const logs: string[] = [];

    // 1. Memory Decay
    nextState.npcs = updateMemoryStrengths(nextState.npcs || [], 0.9);

    // 2. Economy Simulation (Deterministic Tool)
    const econResult = simulateEconomy(nextState);
    nextState = { ...nextState, ...econResult };

    // 3. Manager Agents (Gemini)
    // Only run for 2 managers to save time/tokens in demo
    const managers = (nextState.npcs || []).filter(n => n.role === 'Leader' || n.role === 'Merchant').slice(0, 2);
    
    for (const manager of managers) {
      // 3a. Plan
      const { toolCalls, trace } = await runManagerAgent(manager, nextState, bundle.meta.themeConfig);
      
      if (trace) {
        nextState.decision_traces = [...(nextState.decision_traces || []), trace];
      }

      // 3b. Execute Tools (Sub-Agents)
      for (const call of toolCalls) {
        let result = { success: false, message: '', updates: null as any };
        
        if (call.name === 'build_structure') {
          result = buildStructure(nextState, call.args.location_id, call.args.building_type, manager.id, { gold: call.args.cost_gold, grain: call.args.cost_grain, iron: 0 });
        } else if (call.name === 'simulate_combat') {
          // Invoke God Engine for Combat
          const cRes = await resolveCombatConflict(nextState, manager.faction_id, call.args.target_faction_id, call.args.location_id);
          result = { success: true, message: cRes.outcome, updates: cRes.updates };
        }

        if (result.success && result.updates) {
          nextState = { ...nextState, ...result.updates };
          logs.push(`${manager.name}: ${result.message}`);
          
          // Update Trace with Output
          const currentTraces = nextState.decision_traces || [];
          const traceIdx = currentTraces.findIndex(t => t.decision_trace_id === trace.decision_trace_id);
          if (traceIdx !== -1) {
             currentTraces[traceIdx].tool_calls[0].outputs = { success: true, msg: result.message };
             nextState.decision_traces = [...currentTraces];
          }
        }
      }
    }

    // 4. History Agent
    if (logs.length > 0) {
      const summary = await runHistoryAgent(logs);
      nextState.event_log = [
        ...(nextState.event_log || []), 
        { 
          id: `evt_${Date.now()}`, 
          epoch: nextState.time.epoch, 
          type: 'daily_summary', 
          title: `Day ${nextState.time.day} Summary`, 
          summary, 
          impact: {}, 
          decision_trace_id: (nextState.decision_traces && nextState.decision_traces.length > 0) 
            ? nextState.decision_traces[nextState.decision_traces.length-1].decision_trace_id 
            : null
        }
      ];
    }

    // 5. Finalize
    nextState.time.day += 1;
    nextState.time.epoch += 1;

    // 6. Diff
    const diff = generateWorldDiff(prevState, nextState, nextState.time.epoch);
    
    setBundle(prev => ({
      ...prev,
      world_state: nextState,
      world_diffs: [...prev.world_diffs, diff]
    }));
    
    setProcessing(false);
  };

  const updateNPC = (updatedNPC: NPC) => {
    setBundle(prev => ({
      ...prev,
      world_state: {
        ...prev.world_state,
        npcs: (prev.world_state.npcs || []).map(n => n.id === updatedNPC.id ? updatedNPC : n)
      }
    }));
    // Update local selection if needed
    if (selectedNPC?.id === updatedNPC.id) {
      setSelectedNPC(updatedNPC);
    }
  };

  const handleReset = () => {
    setBundle(INITIAL_BUNDLE);
    setDemoMode(false);
    setSelectedTile(null);
    setSelectedNPC(null);
    localStorage.removeItem('auto_world_v1');
  };

  const exportWorld = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(bundle));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `world_${bundle.meta.world_id}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const isGenesis = bundle.world_state.time.epoch === 0;

  return (
    <div className="min-h-screen bg-gray-900 text-blue-100 font-sans p-4">
      {/* Header */}
      <header className="flex justify-between items-center mb-6 pb-4 border-b border-gray-700">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">AutoWorld <span className="text-blue-500">Empire</span></h1>
          <p className="text-gray-500 text-xs mt-1">Gemini 3 Autonomous Civilization Simulator</p>
          {bundle.meta.themeConfig && (
             <span className="text-[10px] text-gray-400 bg-gray-800 px-2 py-0.5 rounded mt-1 inline-block border border-gray-700">
               {bundle.meta.themeConfig.genre} • {bundle.meta.themeConfig.tone}
             </span>
          )}
        </div>
        <div className="flex gap-2">
          {isGenesis ? (
            <Button onClick={() => setShowSetup(true)} disabled={processing} variant="primary">
              {processing ? 'Generating...' : 'Create New World'}
            </Button>
          ) : (
            <>
              <Button onClick={() => setDemoMode(true)} variant="secondary" disabled={demoMode}>
                 {demoMode ? 'Running Demo...' : '▶ Demo Mode'}
              </Button>
              <Button onClick={handleAdvanceTime} disabled={processing}>
                {processing ? 'Simulating...' : '+24 Hours'}
              </Button>
              <Button onClick={exportWorld} variant="secondary">Share World</Button>
              <Button onClick={handleReset} variant="danger">Reset</Button>
            </>
          )}
        </div>
      </header>

      {/* Main Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left: Map & Stats */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          <Card title={isGenesis ? 'Unknown Territory' : `${bundle.meta.world_name} - Day ${bundle.world_state.time.day}`}>
            {isGenesis ? (
              <div className="h-64 flex items-center justify-center text-gray-500 italic border border-dashed border-gray-700 rounded bg-gray-900/50">
                <div className="text-center">
                  <p className="mb-2">The void awaits creation.</p>
                  <Button onClick={() => setShowSetup(true)} variant="primary">Initialize Genesis</Button>
                </div>
              </div>
            ) : (
              <WorldMap 
                map={bundle.world_state.map} 
                factions={bundle.world_state.factions || []} 
                onTileClick={setSelectedTile}
              />
            )}
          </Card>

          <div className="grid grid-cols-3 gap-4">
             <Card title="Factions">
                <div className="space-y-2">
                  {(bundle.world_state.factions || []).map(f => (
                    <div key={f.id} className="text-xs bg-black/20 p-2 rounded">
                      <div className="font-bold text-white">{f.name}</div>
                      <div className="text-gray-400">Gold: {f.resources.gold} | Troops: {f.military?.troops}</div>
                    </div>
                  ))}
                </div>
             </Card>
             <Card title="Economy">
                <div className="space-y-1">
                  {(bundle.world_state.economy.commodities || []).map(c => (
                    <div key={c.id} className="flex justify-between text-xs border-b border-gray-700 pb-1">
                      <span>{c.id}</span>
                      <span className={c.current_price > c.base_price ? 'text-green-400' : 'text-gray-400'}>
                        {c.current_price.toFixed(1)}g
                      </span>
                    </div>
                  ))}
                  {(bundle.world_state.economy.commodities || []).length === 0 && <span className="text-xs text-gray-500">No market data.</span>}
                </div>
             </Card>
             <Card title="Agents">
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {(bundle.world_state.npcs || []).slice(0, 5).map(n => (
                    <div 
                      key={n.id} 
                      className="text-[10px] text-gray-300 hover:text-blue-300 cursor-pointer"
                      onClick={() => setSelectedNPC(n)}
                    >
                      <span className="font-bold">{n.name}</span> ({n.role})
                    </div>
                  ))}
                </div>
             </Card>
          </div>
        </div>

        {/* Right: Event Feed & Trace */}
        <div className="lg:col-span-4 flex flex-col h-[calc(100vh-140px)]">
          <Card title="Event Chronicle" className="flex-1 flex flex-col min-h-0">
             <div className="overflow-y-auto pr-2 space-y-3 flex-1">
               {(bundle.world_state.event_log || []).length === 0 && <div className="text-gray-600 text-xs">History is waiting to be written...</div>}
               {[...(bundle.world_state.event_log || [])].reverse().map(evt => (
                 <div key={evt.id} className="bg-black/40 border-l-2 border-blue-500 p-3 rounded">
                   <div className="flex justify-between items-start mb-1">
                      <span className="text-[10px] text-gray-500 uppercase">Epoch {evt.epoch}</span>
                      {evt.decision_trace_id && (
                        <button 
                          onClick={() => {
                            const t = (bundle.world_state.decision_traces || []).find(dt => dt.decision_trace_id === evt.decision_trace_id);
                            if (t) setSelectedTrace(t);
                          }}
                          className="text-[10px] bg-blue-900/50 text-blue-300 px-1.5 rounded hover:bg-blue-800"
                        >
                          Why did this happen?
                        </button>
                      )}
                   </div>
                   <h4 className="text-sm font-bold text-white">{evt.title}</h4>
                   <p className="text-xs text-gray-300 mt-1 leading-relaxed">{evt.summary}</p>
                 </div>
               ))}
             </div>
          </Card>
        </div>
      </div>

      <TraceModal trace={selectedTrace!} onClose={() => setSelectedTrace(null)} />
      {showSetup && <SetupModal onConfirm={handleGenesis} onCancel={() => setShowSetup(false)} />}
      {processing && isGenesis && <GenesisLoading />}
      
      {/* Interaction Modals */}
      {selectedTile && (
        <TileInspector 
          tile={selectedTile} 
          worldState={bundle.world_state} 
          onClose={() => setSelectedTile(null)}
          onSelectNPC={(npc) => {
            setSelectedTile(null);
            setSelectedNPC(npc);
          }}
        />
      )}
      
      {selectedNPC && (
        <NPCChatModal 
          npc={selectedNPC} 
          worldState={bundle.world_state}
          theme={bundle.meta.themeConfig}
          onClose={() => setSelectedNPC(null)}
          onUpdateNPC={updateNPC}
        />
      )}
    </div>
  );
};

export default App;