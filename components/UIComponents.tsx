import React, { useState, useEffect, useRef } from 'react';
import { WorldState, Tile, DecisionTrace, ThemeConfig, NPC, Faction, Location } from '../types';
import { TERRAIN_COLORS } from '../constants';
import { generateCharacterPortrait, interactWithNPC, generateSpeech } from '../services/aiService';
import { addMemoryToNPC } from '../services/memoryService';
import { PROVIDER_OPTIONS } from '../services/aiSettings';
import type { ProviderId } from '../services/aiSettings';

// Audio decoding helpers
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function decodePCM(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1,
): AudioBuffer {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export const Button = ({ onClick, children, disabled = false, variant = 'primary', className='' }: any) => {
  const base = "px-4 py-2 rounded font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed transform active:scale-95";
  const variants: any = {
    primary: "bg-blue-600 text-white hover:bg-blue-500 shadow-[0_0_15px_rgba(37,99,235,0.3)]",
    secondary: "bg-gray-700 text-gray-200 hover:bg-gray-600 border border-gray-600",
    danger: "bg-red-900/50 text-red-200 hover:bg-red-800/50 border border-red-800",
    ghost: "bg-transparent text-gray-300 hover:text-white hover:bg-white/5 border border-transparent"
  };
  return <button onClick={onClick} disabled={disabled} className={`${base} ${variants[variant]} ${className}`}>{children}</button>;
};

export const Card = ({ children, title, className = '', headerAction }: any) => (
  <div className={`bg-realm-panel/80 backdrop-blur-md border border-gray-700 rounded-xl p-5 shadow-2xl transition-all duration-300 ${className}`}>
    {title && (
      <div className="flex justify-between items-center mb-4 border-b border-gray-700/50 pb-2">
        <h3 className="text-realm-accent font-bold uppercase tracking-[0.2em] text-[10px]">{title}</h3>
        {headerAction}
      </div>
    )}
    {children}
  </div>
);

const CloudOverlay = () => (
  <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-30 mix-blend-screen">
    <div className="cloud-layer animate-drift-slow"></div>
    <div className="cloud-layer animate-drift-fast opacity-50"></div>
    <style>{`
      .cloud-layer {
        position: absolute;
        width: 400%;
        height: 100%;
        background: radial-gradient(circle at 20% 30%, rgba(255,255,255,0.2) 0%, transparent 40%),
                    radial-gradient(circle at 70% 60%, rgba(255,255,255,0.2) 0%, transparent 35%);
        filter: blur(40px);
      }
      @keyframes drift {
        0% { transform: translateX(-50%); }
        100% { transform: translateX(0%); }
      }
      .animate-drift-slow { animation: drift 120s linear infinite; }
      .animate-drift-fast { animation: drift 80s linear infinite reverse; }
    `}</style>
  </div>
);

export const WorldMap = ({ 
  map, 
  factions, 
  onTileClick 
}: { 
  map: WorldState['map'], 
  factions: any[],
  onTileClick: (tile: Tile) => void
}) => {
  if (!map || !map.tiles) return <div className="animate-pulse text-gray-500">Scanning World...</div>;
  
  return (
    <div className="relative group rounded-lg overflow-hidden border border-gray-800 shadow-[0_0_50px_rgba(0,0,0,0.5)]">
      <div 
        className="grid gap-px bg-gray-950 p-1 shadow-inner relative z-0"
        style={{ 
          gridTemplateColumns: `repeat(${map.width}, minmax(0, 1fr))`,
          aspectRatio: `${map.width}/${map.height}`
        }}
      >
        {map.tiles.map((tile: Tile) => {
          const location = map.locations?.find(l => l.id === tile.location_id);
          const faction = factions?.find(f => f.id === tile.owner_faction_id);
          
          return (
            <div 
              key={`${tile.x}-${tile.y}`}
              onClick={() => onTileClick(tile)}
              className="relative w-full h-full group cursor-pointer hover:z-10 transition-all duration-200"
              style={{ backgroundColor: TERRAIN_COLORS[tile.terrain] }}
            >
              {tile.terrain === 'water' && <div className="absolute inset-0 animate-pulse opacity-20 bg-white/20 blur-[1px]"></div>}
              {tile.terrain === 'mountain' && <div className="absolute inset-0 bg-gradient-to-tr from-black/20 to-transparent"></div>}
              {faction && <div className="absolute inset-0 opacity-20 bg-realm-accent" />}
              {location && (
                <div className="absolute inset-0 flex items-center justify-center">
                   <div className={`text-sm transform group-hover:scale-150 transition-transform duration-300 drop-shadow-[0_0_8px_rgba(255,255,255,0.5)] ${location.unrest > 50 ? 'animate-bounce' : 'animate-pulse'}`}>
                     {location.type === 'town' ? '🏰' : '⛺'}
                   </div>
                </div>
              )}
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 border border-white/40 z-20 transition-opacity"></div>
            </div>
          );
        })}
      </div>
      <CloudOverlay />
    </div>
  );
};

export const TileInspector = ({ tile, worldState, onClose, onSelectNPC }: any) => {
  const location = worldState.map.locations?.find((l:any) => l.id === tile.location_id);
  const faction = worldState.factions?.find((f:any) => f.id === tile.owner_faction_id);
  const npcsHere = (worldState.npcs || []).filter((n:any) => n.location_id === location?.id);
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-40 p-4 animate-in fade-in zoom-in duration-200" onClick={onClose}>
      <div className="bg-realm-panel border border-realm-accent/50 rounded-2xl p-6 max-w-sm w-full shadow-[0_0_50px_rgba(0,0,0,0.8)] relative" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors">✕</button>
        <div className="mb-6">
          <h3 className="text-2xl font-bold text-white mb-1">{location ? location.name : 'Wilderness'}</h3>
          <p className="text-xs text-realm-accent uppercase tracking-widest font-mono">COORD: {tile.x}, {tile.y} • {tile.terrain} {faction ? `• ${faction.name}` : ''}</p>
        </div>
        {location ? (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-black/40 p-2 rounded-lg border border-gray-700/50 text-center">
                <div className="text-[9px] text-gray-500 uppercase font-bold mb-1">Pop</div>
                <div className={`text-sm font-mono font-bold text-white`}>{location.population}</div>
              </div>
              <div className="bg-black/40 p-2 rounded-lg border border-gray-700/50 text-center">
                <div className="text-[9px] text-gray-500 uppercase font-bold mb-1">Def</div>
                <div className={`text-sm font-mono font-bold text-white`}>{location.defense}</div>
              </div>
              <div className="bg-black/40 p-2 rounded-lg border border-gray-700/50 text-center">
                <div className="text-[9px] text-gray-500 uppercase font-bold mb-1">Risk</div>
                <div className={`text-sm font-mono font-bold text-realm-danger`}>{location.unrest}%</div>
              </div>
            </div>
            <div>
              <h4 className="text-[10px] font-bold text-gray-500 uppercase mb-3 tracking-widest border-l-2 border-realm-accent pl-2">Inhabitants</h4>
              <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar">
                {npcsHere.length === 0 && <span className="text-xs text-gray-600 italic">Unpopulated territory...</span>}
                {npcsHere.map((npc: any) => (
                  <div key={npc.id} onClick={() => onSelectNPC(npc)} className="flex items-center justify-between bg-white/5 p-3 rounded-xl cursor-pointer hover:bg-realm-accent/20 border border-transparent hover:border-realm-accent/50 transition-all group">
                     <div>
                       <div className="text-sm font-bold text-blue-200 group-hover:text-white">{npc.name}</div>
                       <div className="text-[10px] text-gray-500 uppercase tracking-tighter">{npc.role}</div>
                     </div>
                     <span className="text-lg opacity-40 group-hover:opacity-100 transition-opacity">💬</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : <p className="text-gray-500 text-sm italic py-8 text-center border border-dashed border-gray-700 rounded-xl">Nothing but wild {tile.terrain} here.</p>}
      </div>
    </div>
  );
};

export const NPCChatModal = ({ npc, worldState, theme, onClose, onUpdateNPC }: any) => {
  const [history, setHistory] = useState<{role: string, text: string}[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const faction = worldState.factions?.find((f:any) => f.id === npc.faction_id);

  useEffect(() => {
    if (!npc.portraitUrl) {
      generateCharacterPortrait(npc, faction?.name || 'Unknown', theme).then(url => {
        if (url) onUpdateNPC({ ...npc, portraitUrl: url });
      });
    }
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [history]);

  const handleSpeak = async (text: string) => {
    setSpeaking(true);
    const voices = ['Kore', 'Puck', 'Fenrir', 'Charon'];
    const voice = voices[Math.floor(Math.random()*voices.length)];
    const base64Audio = await generateSpeech(text, voice);
    if (base64Audio) {
      try {
        if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 24000});
        const ctx = audioContextRef.current;
        const bytes = decode(base64Audio);
        const buffer = decodePCM(bytes, ctx, 24000, 1);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.onended = () => setSpeaking(false);
        source.start(0);
      } catch (e) { setSpeaking(false); }
    } else { setSpeaking(false); }
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input; setInput(''); setLoading(true);
    setHistory(prev => [...prev, { role: 'user', text: userMsg }]);
    try {
      const response = await interactWithNPC(npc, faction?.name || 'Unknown', history, userMsg);
      setHistory(prev => [...prev, { role: 'model', text: response }]);
      onUpdateNPC(addMemoryToNPC(npc, `Traveler said: ${userMsg}`, worldState.time.epoch));
      handleSpeak(response);
    } catch (e) { setHistory(prev => [...prev, { role: 'model', text: "(Silent...)" }]); }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4 backdrop-blur-md animate-in fade-in duration-300">
      <div className="bg-realm-panel border border-gray-700 rounded-3xl w-full max-w-5xl h-[700px] flex overflow-hidden shadow-[0_0_100px_rgba(0,0,0,1)]">
        <div className="w-80 bg-black/40 p-8 flex flex-col border-r border-gray-800 relative">
           <div className="aspect-square bg-gray-900 rounded-2xl mb-6 overflow-hidden border border-gray-700 relative group">
             {npc.portraitUrl ? <img src={npc.portraitUrl} className="w-full h-full object-cover" /> : <div className="w-full h-full animate-pulse bg-gray-800" />}
             <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black to-transparent p-4 flex justify-between items-center">
               <div><h2 className="text-xl font-bold text-white">{npc.name}</h2><div className="text-[10px] text-realm-accent font-mono uppercase">{npc.role}</div></div>
               {speaking && <div className="flex gap-1 h-3 animate-pulse"><div className="w-1 bg-realm-accent h-full" /><div className="w-1 bg-realm-accent h-full" /></div>}
             </div>
           </div>
           <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-4">
             <div className="p-3 bg-white/5 rounded-xl"><h4 className="text-[9px] font-bold text-gray-500 uppercase mb-2">Allegiance</h4><div className="text-sm text-blue-100">{faction?.name}</div></div>
             <div className="p-3 bg-white/5 rounded-xl"><h4 className="text-[9px] font-bold text-gray-500 uppercase mb-2">Goals</h4><ul className="text-xs text-gray-400">{(npc.goals || []).map((g:any, i:number) => <li key={i}>• {g.text}</li>)}</ul></div>
           </div>
        </div>
        <div className="flex-1 flex flex-col bg-[#0b0c14]">
          <div className="p-6 border-b border-gray-800 flex justify-between items-center bg-black/20">
            <span className="text-[10px] text-realm-muted uppercase tracking-[0.3em] font-bold">Neural Link: {npc.name}</span>
            <button onClick={onClose} className="text-gray-500 hover:text-white">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar" ref={scrollRef}>
             {history.map((msg, i) => (
               <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                 <div className={`max-w-[75%] p-4 rounded-2xl text-sm ${msg.role === 'user' ? 'bg-realm-accent/20 text-blue-100 rounded-tr-none' : 'bg-white/5 text-gray-200 rounded-tl-none border border-white/10'}`}>{msg.text}</div>
               </div>
             ))}
          </div>
          <div className="p-6 bg-black/40 border-t border-gray-800 flex gap-3">
            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSend()} placeholder={`Query ${npc.name}...`} className="flex-1 bg-gray-900 border border-gray-700 text-white rounded-xl px-6 py-2" />
            <Button onClick={handleSend} disabled={loading}>Send</Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const TraceModal = ({ trace, onClose }: any) => {
  if (!trace) return null;
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200 backdrop-blur-sm">
      <div className="bg-realm-panel w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl border border-realm-accent/40 p-8 relative">
        <button onClick={onClose} className="absolute top-6 right-6 text-gray-500 hover:text-white">✕</button>
        <h2 className="text-2xl font-bold text-white mb-6">Cognitive Trace // {trace.actor}</h2>
        <div className="space-y-6 font-mono text-xs text-gray-400">
          <section className="bg-black/40 p-4 rounded-xl border border-white/5"><h4 className="text-realm-accent text-[9px] uppercase mb-2">Memory retrieval</h4><ul>{(trace.retrieved_memories || []).map((m:any, i:number) => <li key={i}>› {m.text}</li>)}</ul></section>
          <section className="bg-realm-accent/5 p-4 rounded-xl border border-realm-accent/20"><h4 className="text-realm-accent text-[9px] uppercase mb-2">Computed Plan</h4><div className="text-sm text-white font-bold">{trace.chosen_plan}</div></section>
        </div>
      </div>
    </div>
  );
};

export const GenesisLoading = ({ messages }: { messages?: string[] }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const baseSteps = ["Primordial Compilation...", "Tectonic Synchronization...", "Eco-System Seeding...", "Agent Neuron Activation..."];
  const steps = messages && messages.length > 0 ? [...messages, "Reality Solidification..."] : [...baseSteps, "Reality Solidification..."];

  useEffect(() => {
    const interval = setInterval(() => setCurrentStep((prev) => (prev + 1) % steps.length), 1500);
    return () => clearInterval(interval);
  }, [steps.length]);

  return (
    <div className="fixed inset-0 bg-realm-dark flex flex-col items-center justify-center z-[100] animate-in fade-in duration-1000">
      <div className="relative mb-16">
         <div className="w-48 h-48 rounded-full border border-realm-accent/20 animate-[spin_10s_linear_infinite]"></div>
         <div className="absolute inset-0 flex items-center justify-center flex-col">
            <span className="text-4xl font-black italic tracking-tighter">AutoWorld</span>
            <span className="text-xs text-realm-accent tracking-[0.5em] uppercase">Empire</span>
         </div>
      </div>
      <div className="text-center space-y-6 w-full max-w-sm px-6">
        <h2 className="text-sm font-mono tracking-[0.5em] text-realm-muted uppercase animate-pulse">Initializing Multiverse</h2>
        <p className="text-realm-accent font-mono text-xs">{`> ${steps[currentStep]}`}</p>
        <div className="w-full h-px bg-gray-800 overflow-hidden relative"><div className="absolute inset-0 bg-realm-accent animate-[loading_10.5s_linear_forwards] origin-left" /></div>
      </div>
      <style>{`@keyframes loading { 0% { transform: scaleX(0); } 100% { transform: scaleX(1); } }`}</style>
    </div>
  );
};

const SetupInput = ({ label, value, onChange, suggestions, placeholder }: any) => (
  <div className="space-y-3">
    <label className="block text-[10px] font-bold text-realm-accent uppercase tracking-[0.3em]">{label}</label>
    <input 
      type="text" 
      value={value} 
      onChange={(e) => onChange(e.target.value)} 
      placeholder={placeholder}
      className="w-full bg-black/40 border border-gray-700 text-white px-5 py-3 rounded-xl focus:border-realm-accent focus:ring-1 focus:ring-realm-accent/20 focus:outline-none transition-all placeholder:text-gray-600 shadow-inner"
    />
    <div className="flex flex-wrap gap-2">
      {suggestions.map((s: string) => (
        <button 
          key={s} 
          onClick={() => onChange(s)} 
          className="text-[9px] bg-white/5 hover:bg-realm-accent/20 text-gray-400 hover:text-white px-3 py-1.5 rounded-lg border border-white/5 hover:border-realm-accent/30 transition-all font-bold uppercase tracking-widest"
        >
          {s}
        </button>
      ))}
    </div>
  </div>
);

export const SetupModal = ({ onConfirm, onCancel }: any) => {
  const [genre, setGenre] = useState('');
  const [threat, setThreat] = useState('');
  const [tone, setTone] = useState('');
  
  return (
    <div className="fixed inset-0 bg-black/95 flex items-center justify-center z-50 p-4 backdrop-blur-xl animate-in fade-in duration-500">
      <div className="bg-realm-panel border border-realm-accent/30 rounded-3xl p-10 max-w-2xl w-full shadow-[0_0_100px_rgba(122,162,247,0.1)] relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-realm-accent/50 to-transparent"></div>

        <h2 className="text-4xl font-bold text-white mb-3 tracking-tighter">Forge a Reality</h2>
        <p className="text-realm-muted text-sm mb-10 leading-relaxed max-w-md">
          Parameters defined here will seed the Genesis Agent. Your world will be constructed with specific logic and narrative weight.
        </p>
        
        <div className="space-y-8 mb-12">
          <SetupInput 
            label="Genre / Setting" 
            value={genre} 
            onChange={setGenre} 
            placeholder="e.g. Steampunk Moon Colony..."
            suggestions={['High Fantasy', 'Cyberpunk', 'Post-Apocalyptic', 'Eldritch Horror']}
          />
          <SetupInput 
            label="Major Threat" 
            value={threat} 
            onChange={setThreat} 
            placeholder="e.g. Ancient Necromancer..."
            suggestions={['Resource War', 'Undead Scourge', 'Rogue AI', 'Cosmic Horror']}
          />
          <SetupInput 
            label="World Tone" 
            value={tone} 
            onChange={setTone} 
            placeholder="e.g. Hopeful & Vibrant..."
            suggestions={['Grimdark', 'Adventurous', 'Mysterious', 'Whimsical']}
          />
        </div>

        <div className="flex justify-between items-center pt-8 border-t border-gray-800">
            <button onClick={onCancel} className="text-realm-muted hover:text-white transition-colors text-sm uppercase tracking-widest font-bold">Discard</button>
            <Button 
              onClick={() => onConfirm({ 
                genre: genre || 'High Fantasy', 
                threat: threat || 'Bandits', 
                tone: tone || 'Adventurous' 
              })} 
              className="px-10 py-4 text-lg"
            >
              Forge Empire
            </Button>
        </div>
      </div>
    </div>
  );
};

export const ApiKeyModal = ({ onSave, onCancel, errorMessage, initialProvider, initialBaseUrl, initialModel }: any) => {
  const [providerId, setProviderId] = useState<ProviderId>(initialProvider || 'gemini');
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl || '');
  const [model, setModel] = useState(initialModel || '');
  const [apiKey, setApiKey] = useState('');

  const providerOption = PROVIDER_OPTIONS.find(option => option.id === providerId) || PROVIDER_OPTIONS[0];
  const missingBaseUrl = providerId !== 'gemini' && !baseUrl.trim();
  const missingModel = providerId !== 'gemini' && !model.trim();
  const disableSave = (providerOption.requiresKey && !apiKey.trim()) || missingBaseUrl || missingModel;

  useEffect(() => {
    setBaseUrl(providerOption.defaultBaseUrl);
    setModel(providerOption.defaultModel);
  }, [providerId, providerOption.defaultBaseUrl, providerOption.defaultModel]);

  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[120] p-4 backdrop-blur-md animate-in fade-in duration-300">
      <div className="bg-realm-panel border border-realm-accent/40 rounded-3xl p-8 max-w-lg w-full shadow-[0_0_80px_rgba(0,0,0,0.9)] relative">
        <h2 className="text-3xl font-bold text-white mb-2">AI Settings</h2>
        <p className="text-realm-muted text-sm mb-6">
          Configure your provider, model, and API key to enable world generation and agent actions. Settings are stored locally in your browser.
        </p>
        {errorMessage && (
          <div className="mb-4 rounded-xl border border-realm-danger/40 bg-realm-danger/10 px-4 py-3 text-xs text-realm-danger font-mono">
            {errorMessage}
          </div>
        )}
        <div className="mb-4">
          <label className="block text-[10px] font-bold text-realm-accent uppercase tracking-[0.3em] mb-2">Provider</label>
          <select
            value={providerId}
            onChange={(e) => setProviderId(e.target.value as ProviderId)}
            className="w-full bg-black/40 border border-gray-700 text-white px-4 py-3 rounded-xl focus:border-realm-accent focus:ring-1 focus:ring-realm-accent/20 focus:outline-none transition-all"
          >
            {PROVIDER_OPTIONS.map(option => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </div>
        {providerId !== 'gemini' && (
          <div className="mb-4">
            <label className="block text-[10px] font-bold text-realm-accent uppercase tracking-[0.3em] mb-2">Base URL</label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => {
                setBaseUrl(e.target.value);
              }}
              placeholder="https://api.example.com/v1"
              className="w-full bg-black/40 border border-gray-700 text-white px-5 py-3 rounded-xl focus:border-realm-accent focus:ring-1 focus:ring-realm-accent/20 focus:outline-none transition-all placeholder:text-gray-600 shadow-inner"
            />
          </div>
        )}
        {providerId !== 'gemini' && (
          <div className="mb-4">
            <label className="block text-[10px] font-bold text-realm-accent uppercase tracking-[0.3em] mb-2">Model</label>
            <input
              type="text"
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
              }}
              placeholder="Model name"
              className="w-full bg-black/40 border border-gray-700 text-white px-5 py-3 rounded-xl focus:border-realm-accent focus:ring-1 focus:ring-realm-accent/20 focus:outline-none transition-all placeholder:text-gray-600 shadow-inner"
            />
          </div>
        )}
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={providerOption.requiresKey ? "Paste API key..." : "Optional API key..."}
          className="w-full bg-black/40 border border-gray-700 text-white px-5 py-3 rounded-xl focus:border-realm-accent focus:ring-1 focus:ring-realm-accent/20 focus:outline-none transition-all placeholder:text-gray-600 shadow-inner mb-6"
        />
        <div className="flex items-center justify-between pt-4 border-t border-gray-800">
          {onCancel && (
            <button onClick={onCancel} className="text-realm-muted hover:text-white transition-colors text-sm uppercase tracking-widest font-bold">
              Not Now
            </button>
          )}
          <Button
            onClick={() => onSave({ providerId, apiKey, baseUrl, model })}
            disabled={disableSave}
            className="px-8 py-3 text-sm"
          >
            Save Settings
          </Button>
        </div>
      </div>
    </div>
  );
};
