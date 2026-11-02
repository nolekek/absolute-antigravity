import React from 'react';
import { 
  Radio, 
  GitBranch, 
  CheckCircle2, 
  ShieldCheck, 
  Layers, 
  Cpu, 
  Terminal, 
  MessageSquare, 
  FileCode, 
  Activity,
  Users
} from 'lucide-react';
import { ActiveTab } from '../../types';

interface StatusBarProps {
  activePreset: string;
  activeSlot: number;
  serverPort: number;
  isOnline: boolean;
  autoFailover: boolean;
  totalTokensSession?: number;
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  activePreset,
  activeSlot,
  serverPort,
  isOnline,
  autoFailover,
  totalTokensSession = 148290,
  activeTab,
  setActiveTab,
}) => {
  return (
    <>
      {/* Mobile Bottom Navigation Bar */}
      <nav className="md:hidden flex items-center justify-around h-14 bg-studio-panel/95 border-t border-studio-border backdrop-blur-xl shrink-0 z-40 px-2">
        <button
          onClick={() => setActiveTab('chat')}
          className={`flex flex-col items-center justify-center gap-1 flex-1 py-1 text-[11px] font-medium transition-colors ${
            activeTab === 'chat' ? 'text-indigo-400 font-semibold' : 'text-studio-muted'
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          <span>Cascade</span>
        </button>

        <button
          onClick={() => setActiveTab('editor')}
          className={`flex flex-col items-center justify-center gap-1 flex-1 py-1 text-[11px] font-medium transition-colors ${
            activeTab === 'editor' ? 'text-indigo-400 font-semibold' : 'text-studio-muted'
          }`}
        >
          <FileCode className="w-4 h-4" />
          <span>Files</span>
        </button>

        <button
          onClick={() => setActiveTab('terminal')}
          className={`flex flex-col items-center justify-center gap-1 flex-1 py-1 text-[11px] font-medium transition-colors ${
            activeTab === 'terminal' ? 'text-indigo-400 font-semibold' : 'text-studio-muted'
          }`}
        >
          <Terminal className="w-4 h-4" />
          <span>Terminal</span>
        </button>

        <button
          onClick={() => setActiveTab('presets')}
          className={`flex flex-col items-center justify-center gap-1 flex-1 py-1 text-[11px] font-medium transition-colors ${
            activeTab === 'presets' ? 'text-indigo-400 font-semibold' : 'text-studio-muted'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Presets</span>
        </button>

        <button
          onClick={() => setActiveTab('accounts')}
          className={`flex flex-col items-center justify-center gap-1 flex-1 py-1 text-[11px] font-medium transition-colors ${
            activeTab === 'accounts' ? 'text-indigo-400 font-semibold' : 'text-studio-muted'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Slots</span>
        </button>

        <button
          onClick={() => setActiveTab('logs')}
          className={`flex flex-col items-center justify-center gap-1 flex-1 py-1 text-[11px] font-medium transition-colors ${
            activeTab === 'logs' ? 'text-indigo-400 font-semibold' : 'text-studio-muted'
          }`}
        >
          <Activity className="w-4 h-4" />
          <span>Logs</span>
        </button>
      </nav>

      {/* Desktop Persistent Bottom Status Bar (VS Code / Linear style) */}
      <footer className="hidden md:flex h-7 bg-studio-panel border-t border-studio-border px-3 items-center justify-between text-[11px] text-studio-muted font-mono shrink-0 select-none z-30">
        {/* Left Side: Server Radar, Port, Preset, Branch */}
        <div className="flex items-center gap-4">
          {/* Radar indicator */}
          <div className="flex items-center gap-2">
            <div className="relative flex items-center justify-center w-2.5 h-2.5">
              <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${
                isOnline ? 'bg-cyan-400 animate-ping' : 'bg-rose-400'
              }`} />
              <span className={`relative inline-flex rounded-full h-2 w-2 ${
                isOnline ? 'bg-cyan-500 shadow-glow-cyan' : 'bg-rose-500'
              }`} />
            </div>
            <span className="text-slate-300 font-semibold">
              LS Port: <span className="text-cyan-400 font-bold">{serverPort}</span>
            </span>
          </div>

          <div className="h-3 w-[1px] bg-studio-border" />

          {/* Active Preset Pill */}
          <div className="flex items-center gap-1.5 text-indigo-300">
            <Layers className="w-3 h-3 text-indigo-400" />
            <span>Preset: <strong className="text-indigo-200 capitalize">{activePreset}</strong></span>
          </div>

          <div className="h-3 w-[1px] bg-studio-border" />

          {/* Git Branch */}
          <div className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors cursor-pointer">
            <GitBranch className="w-3 h-3" />
            <span>master</span>
          </div>
        </div>

        {/* Center: Token Counter & Auto Failover */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <Cpu className="w-3 h-3 text-studio-subtle" />
            <span>Session: <strong className="text-slate-200">{(totalTokensSession / 1000).toFixed(1)}k tokens</strong></span>
          </div>

          <div className="h-3 w-[1px] bg-studio-border" />

          <div className="flex items-center gap-1.5">
            <ShieldCheck className={`w-3 h-3 ${autoFailover ? 'text-emerald-400' : 'text-slate-500'}`} />
            <span className={autoFailover ? 'text-emerald-300' : 'text-slate-500'}>
              Auto-Failover: <strong>{autoFailover ? 'ON' : 'OFF'}</strong>
            </span>
          </div>
        </div>

        {/* Right Side: Account slot & Ready */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-emerald-400">
            <CheckCircle2 className="w-3 h-3" />
            <span>Slot #{activeSlot} Active</span>
          </div>

          <div className="h-3 w-[1px] bg-studio-border" />

          <span className="text-studio-subtle text-[10px]">Antigravity v2.28.2</span>
        </div>
      </footer>
    </>
  );
};
