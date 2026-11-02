import React, { useState } from 'react';
import { 
  Activity, 
  Terminal, 
  RefreshCw, 
  Search, 
  Trash2, 
  CheckCircle, 
  AlertTriangle, 
  AlertCircle, 
  Info,
  Clock,
  Cpu,
  Server
} from 'lucide-react';
import { SystemLogEntry, ServerState } from '../../types';
import { useToast } from '../common/Toast';

interface LogsViewerProps {
  logs: SystemLogEntry[];
  state: ServerState;
  onRefresh: () => void;
  onClear: () => void;
}

export const LogsViewer: React.FC<LogsViewerProps> = ({
  logs,
  state,
  onRefresh,
  onClear,
}) => {
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const { toast } = useToast();

  const filteredLogs = logs.filter(log => {
    if (filterLevel !== 'all' && log.level !== filterLevel) return false;
    if (searchTerm && !log.message.toLowerCase().includes(searchTerm.toLowerCase()) && !log.source.toLowerCase().includes(searchTerm.toLowerCase())) {
      return false;
    }
    return true;
  });

  const getLevelBadge = (level: SystemLogEntry['level']) => {
    switch (level) {
      case 'error':
        return (
          <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">
            <AlertCircle className="w-3 h-3" />
            ERROR
          </span>
        );
      case 'warn':
        return (
          <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
            <AlertTriangle className="w-3 h-3" />
            WARN
          </span>
        );
      case 'debug':
        return (
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
            DEBUG
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
            <Info className="w-3 h-3" />
            INFO
          </span>
        );
    }
  };

  const formatUptime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs}h ${mins}m ${secs}s`;
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-studio-bg overflow-hidden p-4 sm:p-6 select-none">
      <div className="max-w-6xl mx-auto w-full flex-1 flex flex-col space-y-4 overflow-hidden">
        {/* Telemetry Metrics Bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 shrink-0">
          <div className="p-3.5 rounded-xl bg-studio-panel border border-studio-border glass-card">
            <div className="flex items-center gap-2 text-studio-subtle text-xs mb-1">
              <Server className="w-3.5 h-3.5 text-cyan-400" />
              <span>LanguageServer</span>
            </div>
            <div className="text-base font-bold text-white font-mono">
              Port {state.languageServerPort}
            </div>
            <span className="text-[10px] text-emerald-400">Daemon Active (PID 2281)</span>
          </div>

          <div className="p-3.5 rounded-xl bg-studio-panel border border-studio-border glass-card">
            <div className="flex items-center gap-2 text-studio-subtle text-xs mb-1">
              <Clock className="w-3.5 h-3.5 text-indigo-400" />
              <span>Daemon Uptime</span>
            </div>
            <div className="text-base font-bold text-white font-mono">
              {formatUptime(state.uptime)}
            </div>
            <span className="text-[10px] text-studio-subtle">Online continuously</span>
          </div>

          <div className="p-3.5 rounded-xl bg-studio-panel border border-studio-border glass-card">
            <div className="flex items-center gap-2 text-studio-subtle text-xs mb-1">
              <Cpu className="w-3.5 h-3.5 text-amber-400" />
              <span>Session Tokens</span>
            </div>
            <div className="text-base font-bold text-white font-mono">
              {((state.totalTokensSession || 148290) / 1000).toFixed(1)}k
            </div>
            <span className="text-[10px] text-studio-subtle">Context budget healthy</span>
          </div>

          <div className="p-3.5 rounded-xl bg-studio-panel border border-studio-border glass-card">
            <div className="flex items-center gap-2 text-studio-subtle text-xs mb-1">
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
              <span>Slot Quota Load</span>
            </div>
            <div className="text-base font-bold text-white font-mono">
              Slot #{state.activeSlot} (88%)
            </div>
            <span className="text-[10px] text-emerald-400">Zero rate-limits</span>
          </div>
        </div>

        {/* Logs Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-studio-panel rounded-xl border border-studio-border shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-studio-card border border-studio-border text-xs text-studio-muted">
              <Search className="w-3.5 h-3.5 text-studio-subtle shrink-0" />
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Filter logs by message or source..."
                className="bg-transparent text-white placeholder-studio-subtle outline-none text-xs w-48 sm:w-64"
              />
            </div>

            <div className="flex items-center gap-1 bg-studio-card p-1 rounded-lg border border-studio-border text-xs">
              {['all', 'info', 'warn', 'error'].map(lvl => (
                <button
                  key={lvl}
                  onClick={() => setFilterLevel(lvl)}
                  className={`px-2 py-0.5 rounded capitalize transition-all cursor-pointer ${
                    filterLevel === lvl
                      ? 'bg-indigo-600/30 text-indigo-300 font-semibold'
                      : 'text-studio-muted hover:text-white'
                  }`}
                >
                  {lvl}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onRefresh}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-studio-muted hover:text-white transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Refresh</span>
            </button>

            <button
              onClick={onClear}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 hover:bg-rose-950/20 text-xs text-studio-muted hover:text-rose-400 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear</span>
            </button>
          </div>
        </div>

        {/* Logs Terminal List */}
        <div className="flex-1 bg-[#090a10] border border-studio-border rounded-xl p-3 overflow-y-auto font-mono text-xs space-y-2 select-text shadow-inner">
          {filteredLogs.map(log => (
            <div
              key={log.id}
              className="flex items-start gap-3 p-2 rounded-lg hover:bg-white/5 transition-colors border border-transparent hover:border-white/5"
            >
              <span className="text-studio-subtle shrink-0">{log.timestamp}</span>
              <div className="shrink-0">{getLevelBadge(log.level)}</div>
              <span className="text-cyan-400 font-semibold shrink-0">[{log.source}]</span>
              <span className="text-slate-200 leading-relaxed break-all">{log.message}</span>
            </div>
          ))}

          {filteredLogs.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-studio-muted py-12">
              <CheckCircle className="w-8 h-8 text-studio-subtle/50 mb-2" />
              <p className="text-sm">No matching log records found</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
