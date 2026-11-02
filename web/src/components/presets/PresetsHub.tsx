import React, { useState } from 'react';
import { 
  Layers, 
  Check, 
  Search, 
  Sparkles, 
  Sliders, 
  ShieldCheck, 
  Info,
  ChevronRight,
  Zap
} from 'lucide-react';
import { PresetItem } from '../../types';
import { useToast } from '../common/Toast';

interface PresetsHubProps {
  presets: PresetItem[];
  activePreset: string;
  onSwitchPreset: (presetId: string, overlays: string[]) => Promise<void>;
}

const AVAILABLE_OVERLAYS = [
  { id: '+qa', label: '+qa (Playwright & TDD)', desc: 'Adds automated testing and validation skills' },
  { id: '+devops', label: '+devops (Docker & CI/CD)', desc: 'Adds cloud containerization and deployment pipelines' },
  { id: '+docker', label: '+docker (Multi-Stage Containers)', desc: 'Enforces docker build optimizations' },
  { id: '+appsec', label: '+appsec (Security & Reversing)', desc: 'Adds OWASP audit and penetration checks' },
  { id: '+web', label: '+web (Frontend UX)', desc: 'Adds React/Tailwind/Next.js design skills' },
];

export const PresetsHub: React.FC<PresetsHubProps> = ({
  presets,
  activePreset,
  onSwitchPreset,
}) => {
  const [search, setSearch] = useState('');
  const [activeOverlays, setActiveOverlays] = useState<string[]>(['+qa']);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const { toast } = useToast();

  const toggleOverlay = (id: string) => {
    setActiveOverlays(prev =>
      prev.includes(id) ? prev.filter(o => o !== id) : [...prev, id]
    );
  };

  const handleSelectPreset = async (presetId: string) => {
    setSwitchingTo(presetId);
    await onSwitchPreset(presetId, activeOverlays);
    setSwitchingTo(null);
    toast(`Preset switched to "${presetId}" with overlays: [${activeOverlays.join(', ')}]`, 'success');
  };

  const filteredPresets = presets.filter(
    p =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.id.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase()) ||
      p.skills.some(s => s.toLowerCase().includes(search.toLowerCase()))
  );

  const currentPresetObj = presets.find(p => p.id === activePreset);

  return (
    <div className="flex-1 flex flex-col h-full bg-studio-bg overflow-y-auto p-4 sm:p-6 select-none">
      {/* Top Banner */}
      <div className="max-w-6xl mx-auto w-full space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-studio-panel via-studio-card to-studio-panel border border-studio-border p-5 rounded-2xl shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 blur-3xl rounded-full pointer-events-none" />

          <div className="flex items-start gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0 shadow-glow-indigo">
              <Layers className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-white">Preset Conductor v3.0</h1>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  16 Presets Active
                </span>
              </div>
              <p className="text-xs sm:text-sm text-studio-muted mt-1 max-w-xl">
                Dynamic skill injection engine. Automatically compiles focused prompts with zero context bloat. Permanent meta-skills are always active.
              </p>
            </div>
          </div>

          {/* Active Preset Current Status Card */}
          <div className="flex items-center gap-3 bg-studio-card/80 border border-indigo-500/40 p-3 rounded-xl shrink-0">
            <div className="text-2xl">{currentPresetObj?.icon || '🌐'}</div>
            <div>
              <div className="text-[11px] text-studio-subtle uppercase tracking-wider font-mono">Current Preset</div>
              <div className="font-bold text-sm text-white capitalize">{currentPresetObj?.name || activePreset}</div>
            </div>
          </div>
        </div>

        {/* Dynamic Overlays Hub Bar */}
        <div className="bg-studio-panel/80 border border-studio-border p-4 rounded-2xl space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
              <Sliders className="w-4 h-4 text-cyan-400" />
              <span>Multi-Skill Overlays</span>
              <span className="text-[10px] text-studio-subtle font-normal">(Click chips to toggle stack add-ons)</span>
            </div>
            <div className="text-[11px] font-mono text-indigo-300">
              Active Overlays: <strong className="text-white">{activeOverlays.join(' ') || 'none'}</strong>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {AVAILABLE_OVERLAYS.map(ov => {
              const isActive = activeOverlays.includes(ov.id);
              return (
                <button
                  key={ov.id}
                  onClick={() => toggleOverlay(ov.id)}
                  title={ov.desc}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-mono font-medium transition-all cursor-pointer ${
                    isActive
                      ? 'bg-cyan-950/60 border border-cyan-500/50 text-cyan-300 shadow-glow-cyan'
                      : 'bg-studio-card/80 border border-studio-border text-studio-muted hover:border-slate-600 hover:text-white'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-cyan-400' : 'bg-slate-600'}`} />
                  <span>{ov.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Search & Grid Controls */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-studio-panel border border-studio-border text-xs text-studio-muted w-full max-w-md focus-within:border-indigo-500/50">
            <Search className="w-4 h-4 text-studio-subtle shrink-0" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search 16 presets or skill keywords..."
              className="w-full bg-transparent text-white placeholder-studio-subtle outline-none"
            />
          </div>

          <span className="text-xs text-studio-muted font-mono hidden sm:inline">
            Showing {filteredPresets.length} of {presets.length}
          </span>
        </div>

        {/* 16-Preset Visual Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-8">
          {filteredPresets.map(p => {
            const isActive = p.id === activePreset;
            const isSwitching = switchingTo === p.id;

            return (
              <div
                key={p.id}
                className={`flex flex-col justify-between p-4 rounded-2xl border transition-all glass-card ${
                  isActive
                    ? 'border-indigo-500/80 bg-indigo-950/20 shadow-glow-indigo ring-1 ring-indigo-500/40'
                    : 'border-studio-border bg-studio-panel/70 hover:border-slate-600'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2.5">
                      <span className="text-2xl p-1.5 rounded-xl bg-white/5 border border-white/10 shrink-0">
                        {p.icon}
                      </span>
                      <div>
                        <h3 className="font-bold text-sm text-white">{p.name}</h3>
                        <span className="text-[10px] font-mono text-cyan-400/90 font-semibold uppercase">
                          {p.id}
                        </span>
                      </div>
                    </div>

                    {isActive && (
                      <span className="flex items-center gap-1 text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                        <Check className="w-3 h-3" />
                        ACTIVE
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-studio-muted line-clamp-2 my-2 leading-relaxed">
                    {p.description}
                  </p>

                  {/* Skills tags */}
                  <div className="flex flex-wrap gap-1 my-3">
                    {p.skills.slice(0, 4).map(skill => (
                      <span
                        key={skill}
                        className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/5 text-slate-300 border border-white/5"
                      >
                        {skill}
                      </span>
                    ))}
                    {p.skills.length > 4 && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-studio-subtle">
                        +{p.skills.length - 4} more
                      </span>
                    )}
                  </div>
                </div>

                {/* Switch Button */}
                <button
                  onClick={() => handleSelectPreset(p.id)}
                  disabled={isActive || isSwitching}
                  className={`w-full mt-2 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-500/30 cursor-default'
                      : 'bg-white/5 hover:bg-indigo-600 text-slate-200 hover:text-white border border-studio-border hover:border-indigo-500 shadow-sm'
                  }`}
                >
                  {isSwitching ? (
                    <span className="flex items-center gap-2">
                      <span className="w-3 h-3 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                      Switching...
                    </span>
                  ) : isActive ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Currently Active</span>
                    </>
                  ) : (
                    <>
                      <span>Activate Preset</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
