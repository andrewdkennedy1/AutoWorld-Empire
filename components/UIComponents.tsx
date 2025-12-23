import React from 'react';

export const Card = ({ children, title, className = '' }: { children?: React.ReactNode, title?: string, className?: string }) => (
  <div className={`bg-realm-panel border border-realm-muted/30 rounded-lg p-4 shadow-lg ${className}`}>
    {title && <h3 className="text-realm-accent font-bold mb-3 uppercase tracking-wider text-sm">{title}</h3>}
    {children}
  </div>
);

export const Badge = ({ text, type = 'neutral' }: { text: string, type?: 'success' | 'danger' | 'warning' | 'neutral' }) => {
  const colors = {
    success: 'bg-realm-success/20 text-realm-success border-realm-success/50',
    danger: 'bg-realm-danger/20 text-realm-danger border-realm-danger/50',
    warning: 'bg-realm-warning/20 text-realm-warning border-realm-warning/50',
    neutral: 'bg-realm-muted/20 text-realm-muted border-realm-muted/50'
  };
  
  return (
    <span className={`px-2 py-0.5 rounded text-xs border ${colors[type]}`}>
      {text}
    </span>
  );
};

export const Button = ({ onClick, children, disabled = false, variant = 'primary' }: { onClick: () => void, children?: React.ReactNode, disabled?: boolean, variant?: 'primary' | 'secondary' | 'danger' }) => {
  const base = "px-4 py-2 rounded font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed";
  const variants = {
    primary: "bg-realm-accent text-realm-dark hover:bg-blue-400",
    secondary: "bg-realm-muted/20 text-realm-text hover:bg-realm-muted/40 border border-realm-muted",
    danger: "bg-realm-danger/20 text-realm-danger hover:bg-realm-danger/40 border border-realm-danger"
  };

  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${variants[variant]}`}>
      {children}
    </button>
  );
};

export const TraceModal = ({ trace, onClose }: { trace: any, onClose: () => void }) => {
  if (!trace) return null;
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-realm-panel w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg border border-realm-accent p-6 relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-realm-muted hover:text-white">✕</button>
        <h2 className="text-xl font-bold text-white mb-4">Agent Decision Trace</h2>
        
        <div className="space-y-4">
          <div>
            <h4 className="text-realm-accent text-sm uppercase">Agent & Goal</h4>
            <p className="text-white">{trace.agentName} — {trace.goal}</p>
          </div>

          <div>
            <h4 className="text-realm-accent text-sm uppercase">Reasoning (Gemini 3)</h4>
            <p className="text-gray-300 italic text-sm p-3 bg-black/30 rounded border-l-2 border-realm-accent">
              "{trace.reasoning}"
            </p>
          </div>

          <div>
            <h4 className="text-realm-accent text-sm uppercase">Memory Context</h4>
            <ul className="list-disc list-inside text-xs text-gray-400">
              {trace.retrievedMemories.map((m: string, i: number) => <li key={i}>{m}</li>)}
            </ul>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <h4 className="text-realm-warning text-sm uppercase">Tool Input</h4>
              <pre className="text-xs bg-black/50 p-2 rounded overflow-x-auto text-realm-warning">
                {JSON.stringify(trace.toolInput, null, 2)}
              </pre>
            </div>
            <div>
              <h4 className="text-realm-success text-sm uppercase">Tool Output</h4>
              <pre className="text-xs bg-black/50 p-2 rounded overflow-x-auto text-realm-success">
                {JSON.stringify(trace.toolOutput, null, 2)}
              </pre>
            </div>
          </div>

          <div>
             <h4 className="text-blue-400 text-sm uppercase">World State Diff</h4>
             <pre className="text-xs bg-blue-900/20 p-2 rounded border border-blue-900 text-blue-300">
                {trace.stateDiff}
              </pre>
          </div>
        </div>
      </div>
    </div>
  );
};