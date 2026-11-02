import React from 'react';
import { GitCommit, Check, FileCheck, ExternalLink } from 'lucide-react';
import { useToast } from '../common/Toast';

interface DiffVisualizerProps {
  file: string;
  additions: number;
  deletions: number;
  diff: string;
  onOpenInEditor?: (file: string) => void;
}

export const DiffVisualizer: React.FC<DiffVisualizerProps> = ({
  file,
  additions,
  deletions,
  diff,
  onOpenInEditor,
}) => {
  const { toast } = useToast();
  const [applied, setApplied] = React.useState(false);

  const lines = diff.split('\n');

  const handleApply = () => {
    setApplied(true);
    toast(`Successfully applied diff to ${file}`, 'success');
  };

  return (
    <div className="my-3 rounded-xl border border-studio-border bg-studio-card/90 overflow-hidden shadow-lg">
      {/* Header bar */}
      <div className="px-3 py-2 bg-studio-panel/90 border-b border-studio-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitCommit className="w-4 h-4 text-cyan-400" />
          <span className="font-mono text-xs font-semibold text-slate-200">{file}</span>
          <div className="flex items-center gap-1.5 text-[11px] font-mono ml-2">
            <span className="text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-500/30">
              +{additions}
            </span>
            <span className="text-rose-400 bg-rose-950/60 px-1.5 py-0.5 rounded border border-rose-500/30">
              -{deletions}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onOpenInEditor && (
            <button
              onClick={() => onOpenInEditor(file)}
              className="flex items-center gap-1 text-[11px] text-studio-muted hover:text-white px-2 py-1 rounded bg-white/5 hover:bg-white/10 transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              <span>Open File</span>
            </button>
          )}

          <button
            onClick={handleApply}
            disabled={applied}
            className={`flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded transition-all cursor-pointer ${
              applied
                ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-500/40'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-glow-indigo'
            }`}
          >
            {applied ? (
              <>
                <FileCheck className="w-3 h-3 text-emerald-400" />
                <span>Applied</span>
              </>
            ) : (
              <>
                <Check className="w-3 h-3" />
                <span>Apply Patch</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Code unified diff view */}
      <div className="p-2 font-mono text-[11px] sm:text-xs overflow-x-auto max-h-72 select-text leading-relaxed bg-[#0c0d14]">
        {lines.map((line, idx) => {
          let lineStyle = 'text-slate-400';
          let prefix = ' ';
          if (line.startsWith('+') && !line.startsWith('+++')) {
            lineStyle = 'bg-emerald-950/40 text-emerald-300 font-medium px-1.5 rounded-sm block';
            prefix = '+';
          } else if (line.startsWith('-') && !line.startsWith('---')) {
            lineStyle = 'bg-rose-950/40 text-rose-300 font-medium px-1.5 rounded-sm block';
            prefix = '-';
          } else if (line.startsWith('@@')) {
            lineStyle = 'text-indigo-400 font-semibold bg-indigo-950/30 px-1.5 py-0.5 my-0.5 rounded-sm block';
          }

          return (
            <div key={idx} className={`${lineStyle} whitespace-pre`}>
              {line}
            </div>
          );
        })}
      </div>
    </div>
  );
};
