import React, { useState } from 'react';
import { 
  Users, 
  RefreshCw, 
  ShieldCheck, 
  ShieldAlert, 
  Check, 
  ArrowRightLeft, 
  Clock, 
  Sparkles,
  Zap,
  Mail,
  AlertCircle
} from 'lucide-react';
import { SlotAccount } from '../../types';
import { useToast } from '../common/Toast';

interface AccountsCarouselProps {
  accounts: SlotAccount[];
  activeSlot: number;
  autoFailover: boolean;
  onSwitchSlot: (slot: number) => Promise<void>;
  onCycleSlot: () => Promise<void>;
  onRefreshQuotas: () => Promise<void>;
  onToggleAutoFailover: () => void;
}

export const AccountsCarousel: React.FC<AccountsCarouselProps> = ({
  accounts,
  activeSlot,
  autoFailover,
  onSwitchSlot,
  onCycleSlot,
  onRefreshQuotas,
  onToggleAutoFailover,
}) => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [switchingSlot, setSwitchingSlot] = useState<number | null>(null);
  const { toast } = useToast();

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await onRefreshQuotas();
    setIsRefreshing(false);
    toast('Account quotas refreshed from Google Antigravity backend', 'success');
  };

  const handleSwitch = async (slot: number) => {
    if (slot === activeSlot) return;
    setSwitchingSlot(slot);
    await onSwitchSlot(slot);
    setSwitchingSlot(null);
    toast(`Switched to Slot #${slot}`, 'success');
  };

  const handleRotate = async () => {
    await onCycleSlot();
    toast('Rotated to next available healthy slot', 'info');
  };

  const getQuotaColor = (percent: number) => {
    if (percent > 60) return 'bg-emerald-500 text-emerald-400';
    if (percent > 20) return 'bg-amber-500 text-amber-400';
    return 'bg-rose-500 text-rose-400';
  };

  const getStatusBadge = (status: SlotAccount['status'], isActive: boolean) => {
    if (isActive) {
      return (
        <span className="flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          ACTIVE
        </span>
      );
    }
    switch (status) {
      case 'cooling':
        return (
          <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
            <Clock className="w-3 h-3" />
            COOLING
          </span>
        );
      case 'exhausted':
        return (
          <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">
            <AlertCircle className="w-3 h-3" />
            EXHAUSTED
          </span>
        );
      default:
        return (
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
            READY
          </span>
        );
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-studio-bg overflow-y-auto p-4 sm:p-6 select-none">
      <div className="max-w-6xl mx-auto w-full space-y-6">
        {/* Top Header Card */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-studio-panel via-studio-card to-studio-panel border border-studio-border p-5 rounded-2xl shadow-xl relative overflow-hidden">
          <div className="flex items-start gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-cyan-600/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0 shadow-glow-cyan">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-white">Multi-Account Rotation Hub</h1>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  4 Quota Slots
                </span>
              </div>
              <p className="text-xs sm:text-sm text-studio-muted mt-1 max-w-xl">
                Automatic slot failover and load balancing. Guarantees 24/7 non-stop AI coding without hit-the-wall quota bans.
              </p>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-2.5">
            <button
              onClick={handleRotate}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white border border-studio-border text-xs font-semibold transition-all cursor-pointer"
            >
              <ArrowRightLeft className="w-3.5 h-3.5 text-cyan-400" />
              <span>Rotate Next</span>
            </button>

            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all shadow-glow-indigo cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>Refresh Quotas</span>
            </button>
          </div>
        </div>

        {/* Failover Bar */}
        <div className="flex items-center justify-between p-4 rounded-xl bg-studio-panel/70 border border-studio-border text-xs">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className={`w-4 h-4 ${autoFailover ? 'text-emerald-400' : 'text-slate-500'}`} />
            <div>
              <span className="font-semibold text-slate-100">Intelligent 429 Auto-Failover: </span>
              <span className="text-studio-muted">
                Automatically rotates to next slot upon rate limit errors
              </span>
            </div>
          </div>

          <button
            onClick={onToggleAutoFailover}
            className={`px-3 py-1 rounded-lg font-mono text-xs font-bold transition-all cursor-pointer ${
              autoFailover
                ? 'bg-emerald-950/60 border border-emerald-500/50 text-emerald-300'
                : 'bg-slate-800 border border-slate-700 text-slate-400'
            }`}
          >
            {autoFailover ? 'ENABLED' : 'DISABLED'}
          </button>
        </div>

        {/* 4 Slots Grid Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pb-8">
          {accounts.map(acc => {
            const isActive = acc.slot === activeSlot;
            const isSwitching = switchingSlot === acc.slot;
            const quotaColor = getQuotaColor(acc.quotaPercent);

            return (
              <div
                key={acc.slot}
                className={`flex flex-col justify-between p-4 rounded-2xl border transition-all glass-card ${
                  isActive
                    ? 'border-emerald-500/60 bg-emerald-950/10 shadow-glow-cyan ring-1 ring-emerald-500/30'
                    : 'border-studio-border bg-studio-panel/80 hover:border-slate-600'
                }`}
              >
                <div>
                  {/* Slot Top Header */}
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-mono text-xs font-bold text-slate-300">
                      SLOT #{acc.slot}
                    </span>
                    {getStatusBadge(acc.status, isActive)}
                  </div>

                  {/* Email & Info */}
                  <div className="flex items-center gap-2 mb-3">
                    <Mail className="w-3.5 h-3.5 text-studio-subtle shrink-0" />
                    <span className="font-mono text-xs text-slate-200 truncate" title={acc.email}>
                      {acc.email}
                    </span>
                  </div>

                  {/* Quota Progress Bar */}
                  <div className="space-y-1.5 my-4">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-studio-subtle">Quota Remaining</span>
                      <span className={`font-mono font-bold ${quotaColor.split(' ')[1]}`}>
                        {acc.quotaPercent}%
                      </span>
                    </div>

                    <div className="w-full h-2 rounded-full bg-studio-bg overflow-hidden border border-studio-border">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${quotaColor.split(' ')[0]}`}
                        style={{ width: `${acc.quotaPercent}%` }}
                      />
                    </div>

                    <p className="text-[11px] text-studio-subtle">{acc.limitDesc}</p>
                  </div>
                </div>

                {/* Actions */}
                <button
                  onClick={() => handleSwitch(acc.slot)}
                  disabled={isActive || isSwitching}
                  className={`w-full mt-2 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-500/30 cursor-default'
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
                    <span>Switch to Slot #{acc.slot}</span>
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
