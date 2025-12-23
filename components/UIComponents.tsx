import React, { useState, useEffect, useRef } from 'react';
import { WorldState, Tile, DecisionTrace, ThemeConfig, NPC, Faction, Location } from '../types';
import { TERRAIN_COLORS } from '../constants';
import { generateCharacterPortrait, interactWithNPC, generateSpeech } from '../services/geminiService';
import { addMemoryToNPC } from '../services/memoryService';

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
  // PCM data from Gemini is int16 (2 bytes per sample), little endian
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      // Normalize Int16 to Float32 [-1.0, 1.0]
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export const Button = ({ onClick, children, disabled = false, variant = 'primary', className='' }: any) => {
  const base = "px-4 py-2 rounded font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed";
  const variants: any = {
    primary: "bg-blue-600 text-white hover:bg-blue-500",
    secondary: "bg-gray-700 text-gray-200 hover:bg-gray-600 border border-gray-600",
    danger: "bg-red-900/50 text-red-200 hover:bg-red-800/50 border border-red-800",
    ghost: "bg-transparent text-gray-300 hover:text-white hover:bg-white/5 border border-transparent"
  };
  return <button onClick={onClick} disabled={disabled} className={`${base} ${variants[variant]} ${className}`}>{children}</button>;
};

export const Card = ({ children, title, className = '' }: any) => (
  <div className={`bg-gray-800/80 border border-gray-700 rounded-lg p-4 shadow-xl ${className}`}>
    {title && <h3 className="text-blue-400 font-bold mb-3 uppercase tracking-wider text-xs">{title}</h3>}
    {children}
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
  if (!map || !map.tiles) return <div>Loading Map...</div>;
  
  return (
    <div 
      className="grid gap-px bg-gray-900 border border-gray-700 p-1 overflow-hidden shadow-inner"
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
            className="relative w-full h-full group cursor-pointer hover:brightness-125 transition-all duration-100"
            style={{ backgroundColor: TERRAIN_COLORS[tile.terrain] }}
            title={`(${tile.x},${tile.y}) ${tile.terrain}`}
          >
            {/* Faction Overlay */}
            {faction && (
              <div className="absolute inset-0 opacity-20 bg-purple-500" />
            )}
            
            {/* Location Marker */}
            {location && (
              <div className="absolute inset-0 flex items-center justify-center">
                 <span className="text-xs font-bold text-white drop-shadow-md transform group-hover:scale-125 transition-transform">
                   {location.type === 'town' ? '🏰' : '⛺'}
                 </span>
              </div>
            )}
            
            {/* Hover Tooltip */}
            <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 z-10 bg-black/90 text-white text-[10px] p-1 rounded whitespace-nowrap pointer-events-none border border-gray-600 shadow-lg">
              {location ? `${location.name} (${location.type})` : tile.terrain}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const TileInspector = ({ 
  tile, 
  worldState, 
  onClose, 
  onSelectNPC 
}: { 
  tile: Tile, 
  worldState: WorldState, 
  onClose: () => void,
  onSelectNPC: (npc: NPC) => void
}) => {
  const location = worldState.map.locations?.find(l => l.id === tile.location_id);
  const faction = worldState.factions?.find(f => f.id === tile.owner_faction_id);
  const npcsHere = (worldState.npcs || []).filter(n => n.location_id === location?.id);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-40 p-4" onClick={onClose}>
      <div className="bg-gray-800 border border-blue-500 rounded-lg p-6 max-w-sm w-full shadow-2xl relative" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-2 right-3 text-gray-400 hover:text-white">✕</button>
        
        <h3 className="text-xl font-bold text-white mb-1">
          {location ? location.name : 'Wilderness'}
        </h3>
        <p className="text-xs text-blue-400 uppercase tracking-wider mb-4">
          ({tile.x}, {tile.y}) • {tile.terrain} {faction ? `• ${faction.name} Territory` : ''}
        </p>

        {location ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-black/30 p-2 rounded">
                <div className="text-xs text-gray-500">Pop</div>
                <div className="text-white font-mono">{location.population}</div>
              </div>
              <div className="bg-black/30 p-2 rounded">
                <div className="text-xs text-gray-500">Defense</div>
                <div className="text-white font-mono">{location.defense}</div>
              </div>
              <div className="bg-black/30 p-2 rounded">
                <div className="text-xs text-gray-500">Unrest</div>
                <div className="text-red-400 font-mono">{location.unrest}%</div>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-bold text-gray-400 uppercase mb-2">Inhabitants</h4>
              <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                {npcsHere.length === 0 && <span className="text-xs text-gray-600 italic">No major NPCs present.</span>}
                {npcsHere.map(npc => (
                  <div 
                    key={npc.id} 
                    onClick={() => onSelectNPC(npc)}
                    className="flex items-center justify-between bg-gray-700/50 p-2 rounded cursor-pointer hover:bg-blue-900/30 border border-transparent hover:border-blue-500 transition-colors"
                  >
                     <div>
                       <div className="text-sm font-bold text-blue-200">{npc.name}</div>
                       <div className="text-[10px] text-gray-400">{npc.role}</div>
                     </div>
                     <span className="text-lg">💬</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-gray-400 text-sm italic">Nothing but wild {tile.terrain} here.</p>
        )}
      </div>
    </div>
  );
};

export const NPCChatModal = ({ 
  npc, 
  worldState, 
  theme,
  onClose, 
  onUpdateNPC 
}: { 
  npc: NPC, 
  worldState: WorldState, 
  theme?: ThemeConfig,
  onClose: () => void,
  onUpdateNPC: (npc: NPC) => void
}) => {
  const [history, setHistory] = useState<{role: string, text: string}[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [generatingImg, setGeneratingImg] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const faction = worldState.factions?.find(f => f.id === npc.faction_id);

  useEffect(() => {
    if (!npc.portraitUrl && !generatingImg) {
      setGeneratingImg(true);
      generateCharacterPortrait(npc, faction?.name || 'Unknown', theme).then(url => {
        if (url) {
          onUpdateNPC({ ...npc, portraitUrl: url });
        }
        setGeneratingImg(false);
      });
    }
  }, [npc.id]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history]);

  const handleSpeak = async (text: string) => {
    setSpeaking(true);
    // Determine voice based on simplistic heuristic from hash of ID
    const voices = ['Kore', 'Puck', 'Fenrir', 'Charon'];
    const voiceIndex = npc.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % voices.length;
    const voice = voices[voiceIndex];

    const base64Audio = await generateSpeech(text, voice);
    
    if (base64Audio) {
      try {
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 24000});
        }
        const ctx = audioContextRef.current;
        if (ctx.state === 'suspended') await ctx.resume();

        const bytes = decode(base64Audio);
        const buffer = decodePCM(bytes, ctx, 24000, 1);
        
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.onended = () => setSpeaking(false);
        source.start(0);
      } catch (e) {
        console.error("Audio playback error", e);
        setSpeaking(false);
      }
    } else {
      setSpeaking(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input;
    setInput('');
    setLoading(true);
    setHistory(prev => [...prev, { role: 'user', text: userMsg }]);

    try {
      const response = await interactWithNPC(npc, faction?.name || 'Unknown', history, userMsg);
      setHistory(prev => [...prev, { role: 'model', text: response }]);
      
      // Implicitly influence memory
      const newNPC = addMemoryToNPC(npc, `Chatted with traveler: "${userMsg}"`, worldState.time.epoch, ['chat', 'player_interaction']);
      onUpdateNPC(newNPC);

      // Trigger TTS
      handleSpeak(response);
    } catch (e) {
      console.error(e);
      setHistory(prev => [...prev, { role: 'model', text: "(The NPC seems distracted and doesn't respond.)" }]);
    }
    setLoading(false);
  };

  const startListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Browser does not support Speech Recognition.");
      return;
    }
    
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput(transcript);
    };

    recognition.start();
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-600 rounded-xl w-full max-w-4xl h-[600px] flex overflow-hidden shadow-2xl">
        
        {/* Left: Portrait & Stats */}
        <div className="w-1/3 bg-gray-800 p-6 flex flex-col border-r border-gray-700 relative">
           <div className="aspect-square bg-gray-900 rounded-lg mb-4 overflow-hidden border border-gray-700 relative shadow-inner">
             {npc.portraitUrl ? (
               <img src={npc.portraitUrl} alt={npc.name} className="w-full h-full object-cover" />
             ) : (
               <div className="w-full h-full flex flex-col items-center justify-center text-gray-500 animate-pulse">
                 <span className="text-4xl mb-2">🎨</span>
                 <span className="text-xs">Painting Portrait...</span>
               </div>
             )}
             <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                <div className="flex justify-between items-end">
                  <div>
                    <h2 className="text-xl font-bold text-white shadow-black drop-shadow-md">{npc.name}</h2>
                    <div className="text-xs text-blue-300 font-mono">{npc.role}</div>
                  </div>
                  {speaking && <span className="text-2xl animate-pulse">🔊</span>}
                </div>
             </div>
           </div>

           <div className="space-y-4 flex-1 overflow-y-auto">
             <div>
               <h4 className="text-xs font-bold text-gray-500 uppercase mb-1">Faction</h4>
               <div className="text-sm text-gray-300">{faction?.name}</div>
             </div>
             <div>
               <h4 className="text-xs font-bold text-gray-500 uppercase mb-1">Goals</h4>
               <ul className="text-xs text-gray-400 list-disc list-inside">
                 {(npc.goals || []).map((g, i) => <li key={i}>{g.text}</li>)}
               </ul>
             </div>
             <div>
               <h4 className="text-xs font-bold text-gray-500 uppercase mb-1">Recent Memories</h4>
               <ul className="text-xs text-gray-400 space-y-1">
                 {(npc.memory || []).slice(0, 3).map(m => (
                   <li key={m.id} className="bg-black/20 p-1 rounded italic">"{m.text}"</li>
                 ))}
               </ul>
             </div>
           </div>
        </div>

        {/* Right: Chat */}
        <div className="w-2/3 flex flex-col bg-[#0f111a]">
          <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-gray-900/50">
            <span className="text-xs text-gray-500 uppercase tracking-widest">Conversation</span>
            <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-6 space-y-4" ref={scrollRef}>
             {history.length === 0 && (
               <div className="text-center text-gray-600 mt-10 italic text-sm">
                 Start a conversation with {npc.name}. Your words may influence them.
               </div>
             )}
             {history.map((msg, i) => (
               <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                 <div className={`max-w-[80%] p-3 rounded-lg text-sm leading-relaxed ${
                   msg.role === 'user' 
                   ? 'bg-blue-900/40 text-blue-100 border border-blue-800 rounded-tr-none' 
                   : 'bg-gray-800 text-gray-200 border border-gray-700 rounded-tl-none'
                 }`}>
                   {msg.text}
                 </div>
               </div>
             ))}
             {loading && (
               <div className="flex justify-start">
                 <div className="bg-gray-800 p-3 rounded-lg rounded-tl-none text-gray-500 text-xs animate-pulse">
                   Thinking...
                 </div>
               </div>
             )}
          </div>

          <div className="p-4 bg-gray-800 border-t border-gray-700">
            <div className="flex gap-2">
              <button 
                onClick={startListening}
                className={`px-3 rounded border ${isListening ? 'bg-red-600 border-red-500 text-white animate-pulse' : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'}`}
                title="Speak to NPC"
              >
                🎤
              </button>
              <input 
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSend()}
                placeholder={`Say something to ${npc.name}...`}
                className="flex-1 bg-gray-900 border border-gray-600 text-white rounded px-4 py-2 focus:border-blue-500 focus:outline-none"
              />
              <Button onClick={handleSend} disabled={loading} variant="primary">Send</Button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export const TraceModal = ({ trace, onClose }: { trace: DecisionTrace, onClose: () => void }) => {
  if (!trace) return null;
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg border border-blue-500 p-6 relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white">✕</button>
        <h2 className="text-xl font-bold text-white mb-1">Decision Trace</h2>
        <p className="text-xs text-blue-400 mb-4 font-mono">{trace.decision_trace_id}</p>
        
        <div className="space-y-4 font-mono text-sm">
          <div>
            <h4 className="text-blue-400 text-xs uppercase mb-1">Agent Goal</h4>
            <div className="bg-black/30 p-2 rounded text-gray-300">
              {trace.actor} wants to: {trace.goal_summary.join(', ')}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
             <div>
               <h4 className="text-purple-400 text-xs uppercase mb-1">Memories Used</h4>
               <ul className="list-disc list-inside text-xs text-gray-400 bg-black/30 p-2 rounded">
                 {(trace.retrieved_memories || []).map((m, i) => <li key={i}>{m.text}</li>)}
               </ul>
             </div>
             <div>
               <h4 className="text-purple-400 text-xs uppercase mb-1">Facts Used</h4>
               <ul className="list-disc list-inside text-xs text-gray-400 bg-black/30 p-2 rounded">
                 {(trace.world_facts_used || []).map((f, i) => <li key={i}>{f}</li>)}
               </ul>
             </div>
          </div>

          <div>
             <h4 className="text-yellow-400 text-xs uppercase mb-1">Reasoning & Choice</h4>
             <div className="bg-black/30 p-2 rounded border-l-2 border-yellow-500 text-white">
                Selected: <span className="font-bold">{trace.chosen_plan}</span>
             </div>
          </div>

          <div>
             <h4 className="text-green-400 text-xs uppercase mb-1">Sub-Agent / Tool Calls</h4>
             {(trace.tool_calls || []).map((tc, i) => (
               <div key={i} className="bg-black/50 p-2 rounded mb-1 border border-green-900">
                 <div className="text-green-300 font-bold">{tc.tool}</div>
                 <div className="text-xs text-gray-500 overflow-x-auto">{JSON.stringify(tc.inputs)}</div>
               </div>
             ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export const GenesisLoading = () => {
  const [currentStep, setCurrentStep] = useState(0);
  
  const steps = [
    "Compiling Laws of Physics...",
    "Forging Tectonic Plates...",
    "Seeding Ancient Forests...",
    "Establishing Trade Routes...",
    "Birthing Faction Leaders...",
    "Simulating Pre-History...",
    "Finalizing Reality..."
  ];

  useEffect(() => {
    // Cycle through steps every 1.2s to keep it moving
    const interval = setInterval(() => {
      setCurrentStep((prev) => (prev + 1) % steps.length);
    }, 1200);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fixed inset-0 bg-[#0f111a] flex flex-col items-center justify-center z-[100]">
      {/* Background Ambience */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-900/20 via-[#0f111a] to-[#0f111a]"></div>
      
      {/* Central Orb Animation */}
      <div className="relative mb-12">
         {/* Outer Ring */}
         <div className="w-32 h-32 rounded-full border-t-2 border-b-2 border-blue-500 animate-[spin_3s_linear_infinite] shadow-[0_0_30px_rgba(59,130,246,0.5)]"></div>
         {/* Inner Ring */}
         <div className="absolute inset-4 rounded-full border-r-2 border-l-2 border-purple-500 animate-[spin_2s_linear_infinite_reverse]"></div>
         {/* Core */}
         <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-16 h-16 bg-blue-500 rounded-full blur-xl animate-pulse opacity-50"></div>
            <span className="relative text-4xl animate-bounce">✨</span>
         </div>
      </div>

      {/* Text Container */}
      <div className="text-center space-y-4 relative z-10 max-w-md px-6">
        <h2 className="text-3xl font-bold bg-gradient-to-r from-blue-400 via-purple-400 to-blue-400 bg-clip-text text-transparent animate-pulse">
          Fabricating World
        </h2>
        
        <div className="h-8 overflow-hidden">
           <p className="text-blue-200/80 font-mono text-sm transition-all duration-300 transform">
             {`> ${steps[currentStep]}`}
           </p>
        </div>

        {/* Fake Progress Bar */}
        <div className="w-full h-1 bg-gray-800 rounded-full overflow-hidden mt-8 max-w-xs mx-auto">
           <div className="h-full bg-gradient-to-r from-blue-600 to-purple-600 animate-[loading_10s_ease-in-out_infinite] w-full origin-left"></div>
        </div>
      </div>
      
      <style>{`
        @keyframes loading {
          0% { transform: scaleX(0); }
          50% { transform: scaleX(0.7); }
          100% { transform: scaleX(1); }
        }
      `}</style>
    </div>
  );
};

const SetupInput = ({ label, value, onChange, suggestions, placeholder }: any) => (
  <div>
    <label className="block text-xs font-bold text-blue-400 uppercase tracking-wider mb-2">{label}</label>
    <input 
      type="text" 
      value={value} 
      onChange={(e) => onChange(e.target.value)} 
      placeholder={placeholder}
      className="w-full bg-gray-900 border border-gray-700 text-white p-3 rounded focus:border-blue-500 focus:outline-none transition-colors shadow-inner"
    />
    <div className="flex flex-wrap gap-2 mt-2">
      {suggestions.map((s: string) => (
        <button 
          key={s} 
          onClick={() => onChange(s)} 
          className="text-[10px] bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded border border-gray-600 transition-colors"
        >
          {s}
        </button>
      ))}
    </div>
  </div>
);

export const SetupModal = ({ onConfirm, onCancel }: { onConfirm: (config: ThemeConfig) => void, onCancel: () => void }) => {
  const [genre, setGenre] = useState('');
  const [threat, setThreat] = useState('');
  const [tone, setTone] = useState('');

  const isComplete = genre.trim() && threat.trim() && tone.trim();

  return (
    <div className="fixed inset-0 bg-black/95 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-gray-800 border border-blue-500 rounded-xl p-8 max-w-lg w-full shadow-2xl shadow-blue-900/20 relative overflow-hidden">
        {/* Decorative Background Element */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />

        <h2 className="text-3xl font-bold text-white mb-2 relative z-10">Forge Your World</h2>
        <p className="text-gray-400 text-sm mb-8 relative z-10">
          Define the seed parameters for the Genesis Agent. Be as creative or specific as you like—the AI will adapt.
        </p>
        
        <div className="space-y-6 mb-8 relative z-10">
          <SetupInput 
            label="Genre / Setting" 
            value={genre} 
            onChange={setGenre} 
            placeholder="e.g. Underwater Steampunk, Cyberpunk Noir, High Fantasy..."
            suggestions={['High Fantasy', 'Cyberpunk', 'Space Opera', 'Post-Apocalyptic', 'Eldritch Horror', 'Wild West']}
          />
          
          <SetupInput 
            label="Major Threat / Conflict" 
            value={threat} 
            onChange={setThreat} 
            placeholder="e.g. The encroaching void, Rogue AI God, Dragonlords..."
            suggestions={['Bandit Warlords', 'Undead Scourge', 'Rogue AI', 'Resource Scarcity', 'Ancient Curse']}
          />

          <SetupInput 
            label="Tone / Atmosphere" 
            value={tone} 
            onChange={setTone} 
            placeholder="e.g. Grim & Gritty, Whimsical, Mysterious, Hopeful..."
            suggestions={['Adventure', 'Grimdark', 'Hopeful', 'Mystery', 'Political Intrigue']}
          />
        </div>

        <div className="flex justify-between items-center relative z-10 pt-4 border-t border-gray-700">
            <button onClick={onCancel} className="text-gray-400 hover:text-white text-sm transition-colors">Cancel</button>
            <Button 
              onClick={() => onConfirm({ 
                genre: genre || 'High Fantasy', 
                threat: threat || 'Unknown Dangers', 
                tone: tone || 'Adventure' 
              })} 
              variant="primary"
            >
              {isComplete ? 'Initialize Genesis' : 'Use Defaults & Generate'}
            </Button>
        </div>
      </div>
    </div>
  )
};