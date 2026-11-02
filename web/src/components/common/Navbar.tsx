import React, { useState } from 'react';
import { 
  Sparkles, 
  Terminal, 
  Layers, 
  Users, 
  FileCode, 
  MessageSquare, 
  FileText, 
  ChevronDown, 
  Plus, 
  Lock, 
  RefreshCw,
  Cpu,
  Zap,
  Activity
} from 'lucide-react';
import { ModelId, ModelInfo, ActiveTab } from '../../types';

interface NavbarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  selectedModel: ModelId;
  setSelectedModel: (m: ModelId) => void;
  activePreset: string;
  activeSlot: number;
  onNewChat: () => void;
  onOpenPinModal: () => void;
  onCycleSlot: () => void;
}

export const MODELS: ModelInfo[] = [
  { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash High', badge: 'Default Planner', desc: 'Next-gen multimodal reasoning with high-fidelity tool dispatch', provider: 'google' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', badge: 'Deep Reasoning', desc: 'Extended context thinking & complex algorithmic architecture', provider: 'google' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', badge: 'Sonnet Thinking', desc: 'Superior code generation with transparent internal CoT', provider: 'anthropic' },
  { id: 'claude-opus-4-6-thinking', name: 'Claude Opus 4.6', badge: 'Opus Thinking', desc: 'Maximum depth reasoning for enterprise refactoring', provider: 'anthropic' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', badge: 'Fast Lite', desc: 'Ultra-low latency for instant responses and fast iterations', provider: 'google' },
];

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  selectedModel,
  setSelectedModel,
  activePreset,
  activeSlot,
  onNewChat,
  onOpenPinModal,
  onCycleSlot,
}) => {
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const currentModel = MODELS.find(m => m.id === selectedModel) || MODELS[0];

  return (
    <header className="h-14 border-b border-studio-border bg-studio-panel/80 backdrop-blur-md px-3 sm:px-5 flex items-center justify-between shrink-0 select-none z-30">
      {/* Brand & Tabs */}
      <div className="flex items-center gap-4 sm:gap-6">
        <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => setActiveTab('chat')}>
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 p-[1px] shadow-glow-indigo flex items-center justify-center">
            <div className="w-full h-full bg-studio-panel rounded-[7px] flex items-center justify-center">
              <Zap className="w-4 h-4 text-cyan-400 fill-cyan-400/20" />
            </div>
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-sm tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent flex items-center gap-1.5">
              ANTIGRAVITY
              <span className="text-[10px] px-1.5 py-0.2 font-mono font-bold uppercase rounded bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                STUDIO
              </span>
            </span>
          </div>
        </div>

        {/* Desktop Navigation Links */}
        <nav className="hidden md:flex items-center gap-1 bg-studio-card/60 p-1 rounded-xl border border-studio-border/60">
          <button
            onClick={() => setActiveTab('chat')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'chat'
                ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 shadow-sm'
                : 'text-studio-muted hover:text-white hover:bg-white/5'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Cascade</span>
          </button>

          <button
            onClick={() => setActiveTab('editor')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'editor'
                ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 shadow-sm'
                : 'text-studio-muted hover:text-white hover:bg-white/5'
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>Files & Code</span>
          </button>

          <button
            onClick={() => setActiveTab('terminal')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'terminal'
                ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 shadow-sm'
                : 'text-studio-muted hover:text-white hover:bg-white/5'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Terminal</span>
          </button>

          <button
            onClick={() => setActiveTab('presets')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'presets'
                ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 shadow-sm'
                : 'text-studio-muted hover:text-white hover:bg-white/5'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Presets Hub</span>
          </button>

          <button
            onClick={() => setActiveTab('accounts')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'accounts'
                ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 shadow-sm'
                : 'text-studio-muted hover:text-white hover:bg-white/5'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Accounts</span>
          </button>

          <button
            onClick={() => setActiveTab('logs')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'logs'
                ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 shadow-sm'
                : 'text-studio-muted hover:text-white hover:bg-white/5'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Logs</span>
          </button>
        </nav>
      </div>

      {/* Model Selector & Actions */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Model Switcher Dropdown */}
        <div className="relative">
          <button
            onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
            className="flex items-center gap-2 bg-studio-card/80 hover:bg-studio-card border border-studio-border hover:border-indigo-500/40 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer shadow-sm"
          >
            <Cpu className="w-3.5 h-3.5 text-cyan-400" />
            <span className="font-semibold text-slate-200 hidden sm:inline">{currentModel.name}</span>
            <span className="font-semibold text-slate-200 sm:hidden">{currentModel.badge}</span>
            <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded font-mono hidden md:inline">
              {currentModel.badge}
            </span>
            <ChevronDown className="w-3 h-3 text-studio-muted ml-0.5" />
          </button>

          {modelDropdownOpen && (
            <div className="absolute right-0 mt-2 w-72 sm:w-80 bg-studio-panel/95 backdrop-blur-xl border border-studio-border rounded-xl shadow-2xl p-2 z-50 animate-fade-in">
              <div className="px-2 py-1.5 text-[11px] font-semibold text-studio-subtle uppercase tracking-wider border-b border-studio-border/60 mb-1">
                Select AI Engine
              </div>
              <div className="flex flex-col gap-1">
                {MODELS.map(m => (
                  <button
                    key={m.id}
                    onClick={() => {
                      setSelectedModel(m.id);
                      setModelDropdownOpen(false);
                    }}
                    className={`flex flex-col text-left p-2 rounded-lg transition-all text-xs cursor-pointer ${
                      selectedModel === m.id
                        ? 'bg-indigo-600/20 border border-indigo-500/40 text-white'
                        : 'hover:bg-white/5 text-studio-muted hover:text-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="font-semibold text-slate-100">{m.name}</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-cyan-300">
                        {m.badge}
                      </span>
                    </div>
                    <span className="text-[11px] text-studio-subtle mt-1 leading-snug">{m.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Active Slot Quick Action */}
        <button
          onClick={onCycleSlot}
          title="Active Account Slot - Click to cycle"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-emerald-500/30 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-900/40 text-xs font-mono transition-all cursor-pointer"
        >
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="hidden sm:inline">Slot #{activeSlot}</span>
          <RefreshCw className="w-3 h-3 text-emerald-400/80 hover:rotate-180 transition-transform" />
        </button>

        {/* New Chat Button */}
        <button
          onClick={onNewChat}
          className="flex items-center gap-1.5 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-medium transition-all shadow-glow-indigo cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">New Session</span>
        </button>

        {/* Lock / PIN Button */}
        <button
          onClick={onOpenPinModal}
          title="Security PIN Lock"
          className="p-1.5 rounded-xl border border-studio-border bg-studio-card/80 hover:bg-studio-card text-studio-muted hover:text-white transition-all cursor-pointer"
        >
          <Lock className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
