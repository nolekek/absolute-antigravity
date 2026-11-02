import React, { useState } from 'react';
import { GitBranch, GitCommit, FileCode, CheckCircle, RefreshCw } from 'lucide-react';
import { GitDiffFile } from '../../types';
import { DiffVisualizer } from '../chat/DiffVisualizer';

interface GitDiffViewProps {
  diffs: GitDiffFile[];
  onRefresh: () => void;
  onOpenInEditor: (file: string) => void;
}

export const GitDiffView: React.FC<GitDiffViewProps> = ({
  diffs,
  onRefresh,
  onOpenInEditor,
}) => {
  const [selectedFile, setSelectedFile] = useState<string>(diffs[0]?.path || '');

  const currentDiff = diffs.find(d => d.path === selectedFile) || diffs[0];

  return (
    <div className="flex-1 flex flex-col h-full bg-studio-bg overflow-hidden">
      {/* Git Diff Top Header */}
      <div className="h-10 px-4 bg-studio-panel border-b border-studio-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-semibold text-slate-100">Working Tree Changes</span>
          <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-white/10 text-studio-muted">
            {diffs.length} modified files
          </span>
        </div>

        <button
          onClick={onRefresh}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-studio-muted hover:text-white transition-colors cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh Git Diff</span>
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Changed Files Sidebar */}
        <div className="w-64 bg-studio-panel/70 border-r border-studio-border flex flex-col shrink-0">
          <div className="p-2 text-[11px] font-semibold text-studio-subtle uppercase tracking-wider border-b border-studio-border/60">
            Changed Files
          </div>
          <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
            {diffs.map(file => {
              const isSelected = file.path === selectedFile;
              return (
                <button
                  key={file.path}
                  onClick={() => setSelectedFile(file.path)}
                  className={`w-full flex items-center justify-between p-2 rounded-lg text-xs font-mono text-left transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/40'
                      : 'text-studio-muted hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-1.5 truncate">
                    <FileCode className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    <span className="truncate">{file.path}</span>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] shrink-0">
                    <span className="text-emerald-400">+{file.additions}</span>
                    <span className="text-rose-400">-{file.deletions}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Diff Content Preview */}
        <div className="flex-1 p-4 overflow-y-auto bg-[#090a10]">
          {currentDiff ? (
            <div>
              <DiffVisualizer
                file={currentDiff.path}
                additions={currentDiff.additions}
                deletions={currentDiff.deletions}
                diff={currentDiff.diff}
                onOpenInEditor={file => onOpenInEditor(file)}
              />
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-studio-muted">
              <CheckCircle className="w-10 h-10 text-emerald-500/60 mb-2" />
              <p className="text-sm font-medium">Working tree clean</p>
              <p className="text-xs text-studio-subtle">No uncommitted changes detected</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
