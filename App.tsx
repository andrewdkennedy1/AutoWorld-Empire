import React, { useState, useEffect } from 'react';
import { EMPTY_STATE, INITIAL_BUNDLE } from './constants';
import { WorldBundle, WorldState, DecisionTrace, ThemeConfig, Tile, NPC } from './types';
import { runGenesisAgent, runManagerAgent, runHistoryAgent, generateLoadingMessages, runToolEvolutionAgent, runWorldEventAgent, runToolExecutionAgent } from './services/aiService';
import { API_KEY_REQUIRED_MESSAGE, getProviderConfig, hasApiKey, setProviderConfig, setStoredApiKey } from './services/aiSettings';
import type { ProviderId } from './services/aiSettings';
import { buildStructure, simulateEconomy, generateWorldDiff, applyInfluence } from './services/toolService';
import { addTool, canUseTool, getToolById, loadToolDb, markToolUsed, saveToolDb } from './services/toolDb';
import type { ToolDB } from './services/toolDb';
import { resolveCombatConflict } from './services/godEngine';
import { updateMemoryStrengths } from './services/memoryService';
import { Card, Button, WorldMap, TraceModal, SetupModal, GenesisLoading, TileInspector, NPCChatModal, ApiKeyModal } from './components/UIComponents';

const TimeTransition = ({ active }: { active: boolean }) => (
  <div className={`fixed inset-0 z-[60] pointer-events-none transition-all duration-[1500ms] ${active ? 'bg-black opacity-60' : 'bg-transparent opacity-0'}`}>
     <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-700 ${active ? 'opacity-100' : 'opacity-0'}`}>
        <div className="text-realm-accent text-6xl opacity-20 blur-sm">⏳</div>
     </div>
  </div>
);

const App = () => {
  const [bundle, setBundle] = useState<WorldBundle>(() => {
    const saved = localStorage.getItem('auto_world_v1');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
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
              locations: (parsed.world_state?.map?.locations || []).map((l: any) => ({ ...l, buildings: l.buildings || [] })),
              routes: parsed.world_state?.map?.routes || [],
            }
          }
        };
      } catch (e) { return INITIAL_BUNDLE; }
    }
    return INITIAL_BUNDLE;
  });

  const [processing, setProcessing] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState<string[]>([]);
  const [timeFlash, setTimeFlash] = useState(false);
  const [selectedTrace, setSelectedTrace] = useState<DecisionTrace | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [selectedNPCId, setSelectedNPCId] = useState<string | null>(null);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [toolDb, setToolDb] = useState<ToolDB>(() => loadToolDb());
  const [autoRun, setAutoRun] = useState(false);
  const [autoSpeed, setAutoSpeed] = useState(3500);

  useEffect(() => {
    localStorage.setItem('auto_world_v1', JSON.stringify(bundle));
  }, [bundle]);

  useEffect(() => {
    saveToolDb(toolDb);
  }, [toolDb]);

  useEffect(() => {
    const providerConfig = getProviderConfig();
    if (providerConfig.providerId !== 'gemini' && !providerConfig.baseUrl.trim()) {
      setApiKeyError('Error: Provider base URL is required.');
      setShowApiKeyModal(true);
      return;
    }
    if (!hasApiKey()) {
      setApiKeyError(`Error: ${API_KEY_REQUIRED_MESSAGE}`);
      setShowApiKeyModal(true);
    }
  }, []);

  useEffect(() => {
    if (demoMode && !processing) {
      if (bundle.world_state.time.day < 4) {
        setTimeout(() => handleAdvanceTime(), 2000); // Throttled for demo mode
      } else {
        setDemoMode(false);
        const traces = bundle.world_state.decision_traces || [];
        if (traces.length > 0) setSelectedTrace(traces[traces.length - 1]);
      }
    }
  }, [demoMode, processing, bundle.world_state.time.day]);

  const isGenesis = bundle.world_state.time.epoch === 0;

  useEffect(() => {
    if (!autoRun || processing || isGenesis) return;
    const timer = setTimeout(() => handleAdvanceTime(), autoSpeed);
    return () => clearTimeout(timer);
  }, [autoRun, autoSpeed, processing, isGenesis, bundle.world_state.time.epoch]);

  const ensureApiKey = () => {
    const providerConfig = getProviderConfig();
    if (providerConfig.providerId !== 'gemini' && !providerConfig.baseUrl.trim()) {
      setApiKeyError('Error: Provider base URL is required.');
      setShowApiKeyModal(true);
      return false;
    }
    if (providerConfig.providerId !== 'gemini' && !providerConfig.model.trim()) {
      setApiKeyError('Error: Provider model is required.');
      setShowApiKeyModal(true);
      return false;
    }
    if (hasApiKey()) return true;
    setApiKeyError(`Error: ${API_KEY_REQUIRED_MESSAGE}`);
    setShowApiKeyModal(true);
    return false;
  };

  const handleSaveApiKey = (config: { providerId: ProviderId; apiKey: string; baseUrl: string; model: string }) => {
    setProviderConfig({ providerId: config.providerId, baseUrl: config.baseUrl, model: config.model });
    if (config.apiKey.trim()) {
      setStoredApiKey(config.providerId, config.apiKey);
    }
    setApiKeyError(null);
    setShowApiKeyModal(false);
  };

  const handleGenesis = async (theme: ThemeConfig) => {
    if (!ensureApiKey()) return;
    setProcessing(true);
    setShowSetup(false);
    try {
      const msgs = await generateLoadingMessages(theme);
      setLoadingMsgs(msgs);

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
        meta: { ...bundle.meta, themeConfig: theme, world_name: `Empire of ${theme.genre}` } 
      });
    } catch (e) { console.error(e); }
    setProcessing(false);
  };

  const handleAdvanceTime = async () => {
    if (processing) return;
    if (!ensureApiKey()) return;
    setProcessing(true);
    setTimeFlash(true);
    await new Promise(r => setTimeout(r, 600));

    const prevState = JSON.parse(JSON.stringify(bundle.world_state));
    let nextState = { ...bundle.world_state };
    const logs: string[] = [];

    nextState.npcs = updateMemoryStrengths(nextState.npcs || [], 0.9);
    const econResult = simulateEconomy(nextState);
    nextState = { ...nextState, ...econResult };

    // Process managers with small delay between calls to avoid quota spikes
    const managers = (nextState.npcs || []).filter(n => n.role === 'Leader' || n.role === 'Merchant').slice(0, 2);
    for (const manager of managers) {
      await new Promise(r => setTimeout(r, 800)); // Rate limiting gap
      const { toolCalls, trace } = await runManagerAgent(manager, nextState, bundle.meta.themeConfig, toolDb);
      if (trace) nextState.decision_traces = [...(nextState.decision_traces || []), trace];
      for (const call of toolCalls) {
        let result = { success: false, message: '', updates: null as any };
        if (call.name === 'build_structure') {
          result = buildStructure(nextState, call.args.location_id, call.args.building_type, manager.id, { gold: call.args.cost_gold, grain: call.args.cost_grain, iron: 0 });
        } else if (call.name === 'simulate_combat') {
          const cRes = await resolveCombatConflict(nextState, manager.faction_id, call.args.target_faction_id, call.args.location_id);
          result = { success: true, message: cRes.outcome, updates: cRes.updates };
        } else if (call.name === 'execute_tool') {
          const tool = getToolById(toolDb, call.args.tool_id);
          if (tool && canUseTool(toolDb, tool.id, nextState)) {
            const execution = await runToolExecutionAgent(nextState, manager, tool, call.args.arguments || {}, bundle.meta.themeConfig);
            if (execution) {
              for (const action of execution.calls) {
                let actionResult = { success: false, message: '', updates: null as any };
                if (action.tool === 'build_structure') {
                  actionResult = buildStructure(nextState, action.args.location_id, action.args.building_type, manager.id, { gold: action.args.cost_gold, grain: action.args.cost_grain, iron: 0 });
                } else if (action.tool === 'simulate_combat') {
                  const cRes = await resolveCombatConflict(nextState, manager.faction_id, action.args.target_faction_id, action.args.location_id);
                  actionResult = { success: true, message: cRes.outcome, updates: cRes.updates };
                } else if (action.tool === 'apply_influence') {
                  actionResult = applyInfluence(nextState, action.args);
                }
                if (actionResult.success && actionResult.updates) {
                  nextState = { ...nextState, ...actionResult.updates };
                }
              }
              result = { success: true, message: execution.summary, updates: null };
              setToolDb(prev => markToolUsed(prev, tool.id, nextState.time.epoch));
            } else {
              result = { success: false, message: 'Tool execution failed', updates: null };
            }
          } else {
            result = { success: false, message: 'Tool unavailable', updates: null };
          }
        }
        if (result.success) {
          if (result.updates) nextState = { ...nextState, ...result.updates };
          if (result.message) logs.push(`${manager.name}: ${result.message}`);
        }
      }
    }

    if (logs.length > 0) {
      const summary = await runHistoryAgent(logs);
      nextState.event_log = [...(nextState.event_log || []), { 
        id: `evt_${Date.now()}`, epoch: nextState.time.epoch, type: 'summary', title: `Day ${nextState.time.day} Summary`, 
        summary, impact: {}, decision_trace_id: (nextState.decision_traces?.length ? nextState.decision_traces[nextState.decision_traces.length-1].decision_trace_id : null)
      }];
    }

    const worldEvent = await runWorldEventAgent(nextState, bundle.meta.themeConfig);
    if (worldEvent) {
      nextState.event_log = [...(nextState.event_log || []), {
        id: `evt_world_${Date.now()}`,
        epoch: nextState.time.epoch,
        type: worldEvent.type,
        title: worldEvent.title,
        summary: worldEvent.summary,
        impact: {},
        decision_trace_id: null
      }];
    }

    if (toolDb.last_evolved_epoch !== nextState.time.epoch) {
      const newTool = await runToolEvolutionAgent(nextState, toolDb, bundle.meta.themeConfig);
      if (newTool) {
        setToolDb(prev => ({
          ...addTool(prev, newTool),
          last_evolved_epoch: nextState.time.epoch
        }));
        nextState.event_log = [...(nextState.event_log || []), {
          id: `evt_tool_${Date.now()}`,
          epoch: nextState.time.epoch,
          type: 'tool_evolution',
          title: `Tool Emerged: ${newTool.name}`,
          summary: newTool.lore || newTool.description,
          impact: { tool_id: newTool.id },
          decision_trace_id: null
        }];
      }
    }

    nextState.time.day += 1;
    nextState.time.epoch += 1;
    setBundle(prev => ({ ...prev, world_state: nextState, world_diffs: [...prev.world_diffs, generateWorldDiff(prevState, nextState, nextState.time.epoch)] }));
    setTimeout(() => setTimeFlash(false), 900);
    setProcessing(false);
  };

  const currentSelectedNPC = selectedNPCId ? bundle.world_state.npcs.find(n => n.id === selectedNPCId) : null;

  return (
    <div className="min-h-screen bg-realm-dark text-realm-text font-sans p-4 custom-scrollbar selection:bg-realm-accent/40 bg-[radial-gradient(circle_at_top,_rgba(122,162,247,0.12),_transparent_55%),linear-gradient(180deg,_#141622,_#0c0d14)]">
      <TimeTransition active={timeFlash} />
      <header className="relative z-10 flex flex-col md:flex-row justify-between items-center mb-8 pb-6 border-b border-gray-800 gap-4">
        <div className="flex items-center gap-4">
           <div className="w-12 h-12 bg-realm-accent rounded-xl flex items-center justify-center text-white text-2xl shadow-[0_0_20px_rgba(122,162,247,0.5)]">🏛️</div>
           <div>
             <h1 className="text-3xl font-black text-white tracking-tighter uppercase italic">AutoWorld <span className="text-realm-accent">Empire</span></h1>
             {bundle.meta.themeConfig && <span className="text-[9px] font-mono text-realm-muted uppercase tracking-widest">{bundle.meta.themeConfig.genre} // {bundle.meta.themeConfig.tone}</span>}
             {!isGenesis && (
               <div className="text-[10px] text-gray-400 uppercase tracking-[0.3em] mt-1">
                 Day {bundle.world_state.time.day} • Tools {toolDb.tools.length}
               </div>
             )}
           </div>
        </div>
        <div className="flex gap-3">
          <Button onClick={() => setShowApiKeyModal(true)} variant="ghost">AI Settings</Button>
          {isGenesis ? <Button onClick={() => setShowSetup(true)} disabled={processing}>Initialize Simulation</Button> : (
            <>
              <Button onClick={() => setAutoRun(prev => !prev)} variant={autoRun ? "secondary" : "ghost"} disabled={processing}>
                {autoRun ? 'Autoplay On' : 'Autoplay Off'}
              </Button>
              <select
                value={autoSpeed}
                onChange={(e) => setAutoSpeed(Number(e.target.value))}
                className="bg-black/40 border border-gray-700 text-white px-3 py-2 rounded-lg text-xs uppercase tracking-widest"
              >
                <option value={2500}>Rapid</option>
                <option value={3500}>Flow</option>
                <option value={5000}>Cinematic</option>
              </select>
              <Button onClick={() => setDemoMode(true)} variant="secondary" disabled={demoMode}>Demo Mode</Button>
              <Button onClick={handleAdvanceTime} disabled={processing}>Advance +24h</Button>
              <Button onClick={() => { localStorage.removeItem('auto_world_v1'); window.location.reload(); }} variant="danger">Reset</Button>
            </>
          )}
        </div>
      </header>

      <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 flex flex-col gap-8">
          <Card title={isGenesis ? 'Ready for Seeding' : `Day ${bundle.world_state.time.day} • Epoch ${bundle.world_state.time.epoch}`}>
            {isGenesis ? (
              <div className="h-96 flex flex-col items-center justify-center text-realm-muted border-2 border-dashed border-gray-800 rounded-3xl bg-black/20">
                <span className="text-6xl mb-4">🌌</span>
                <p className="text-sm font-mono tracking-widest uppercase mb-6">Simulation Idle</p>
                <Button onClick={() => setShowSetup(true)}>Begin Genesis</Button>
              </div>
            ) : <WorldMap map={bundle.world_state.map} factions={bundle.world_state.factions || []} onTileClick={setSelectedTile} />}
          </Card>
          {!isGenesis && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card title="Factions">{(bundle.world_state.factions || []).map(f => <div key={f.id} className="text-xs border-b border-white/5 py-1 flex justify-between"><span>{f.name}</span><span className="text-realm-accent font-bold">{f.military?.troops} Soldiers</span></div>)}</Card>
                <Card title="Economy">{(bundle.world_state.economy.commodities || []).map(c => <div key={c.id} className="text-[10px] flex justify-between py-1 border-b border-white/5"><span>{c.id}</span><span className={c.current_price > c.base_price ? 'text-realm-danger' : 'text-realm-success'}>{c.current_price.toFixed(1)}G</span></div>)}</Card>
                <Card title="Agents">{(bundle.world_state.npcs || []).slice(0, 4).map(n => <div key={n.id} onClick={() => setSelectedNPCId(n.id)} className="text-[10px] bg-white/5 p-2 rounded cursor-pointer hover:bg-realm-accent/10 mb-1">{n.name} ({n.role})</div>)}</Card>
              </div>
              <Card title="Tool Archive">
                {toolDb.tools.length === 0 ? (
                  <div className="text-xs text-gray-500 italic">No shared tools yet. The archive will evolve as days pass.</div>
                ) : (
                  toolDb.tools.slice(-6).reverse().map(tool => (
                    <div key={tool.id} className="text-[10px] border-b border-white/5 py-2">
                      <div className="text-realm-accent font-bold uppercase tracking-widest">{tool.name}</div>
                      <div className="text-gray-400">{tool.description}</div>
                      <div className="text-gray-500 italic">{tool.action_guidance}</div>
                    </div>
                  ))
                )}
              </Card>
            </>
          )}
        </div>
        <div className="lg:col-span-4 h-[calc(100vh-160px)] sticky top-4">
          <Card title="Chronicle" className="h-full flex flex-col">
             <div className="overflow-y-auto pr-3 space-y-4 flex-1 custom-scrollbar">
               {[...(bundle.world_state.event_log || [])].reverse().map((evt) => {
                 const accent = evt.type === 'tool_evolution' ? 'border-realm-warning' : evt.type === 'world_event' ? 'border-realm-success' : 'border-realm-accent';
                 return (
                   <div key={evt.id} className={`bg-black/40 border-l-2 ${accent} p-4 rounded-xl group animate-in slide-in-from-right duration-500`}>
                     <div className="flex justify-between items-start mb-2">
                       <span className="text-[8px] text-realm-muted uppercase tracking-widest">Day {evt.epoch}</span>
                       {evt.decision_trace_id && <button onClick={() => { const t = bundle.world_state.decision_traces?.find(dt => dt.decision_trace_id === evt.decision_trace_id); if (t) setSelectedTrace(t); }} className="text-[9px] text-realm-accent hover:text-white underline">Trace</button>}
                     </div>
                     <h4 className="text-xs font-black text-white mb-2 uppercase tracking-tight">{evt.title}</h4>
                     <p className="text-[11px] text-gray-400 leading-relaxed font-serif italic">{evt.summary}</p>
                   </div>
                 );
               })}
             </div>
          </Card>
        </div>
      </div>

      <TraceModal trace={selectedTrace!} onClose={() => setSelectedTrace(null)} />
      {showSetup && <SetupModal onConfirm={handleGenesis} onCancel={() => setShowSetup(false)} />}
      {processing && isGenesis && <GenesisLoading messages={loadingMsgs} />}
      {showApiKeyModal && (
        <ApiKeyModal
          onSave={handleSaveApiKey}
          onCancel={() => setShowApiKeyModal(false)}
          errorMessage={apiKeyError}
          initialProvider={getProviderConfig().providerId}
          initialBaseUrl={getProviderConfig().baseUrl}
          initialModel={getProviderConfig().model}
        />
      )}
      {selectedTile && <TileInspector tile={selectedTile} worldState={bundle.world_state} onClose={() => setSelectedTile(null)} onSelectNPC={(npc: NPC) => setSelectedNPCId(npc.id)} />}
      {currentSelectedNPC && <NPCChatModal npc={currentSelectedNPC} worldState={bundle.world_state} theme={bundle.meta.themeConfig} onClose={() => setSelectedNPCId(null)} onUpdateNPC={(n:any) => setBundle({ ...bundle, world_state: { ...bundle.world_state, npcs: bundle.world_state.npcs.map(o => o.id === n.id ? n : o)}})} />}
    </div>
  );
};

export default App;
