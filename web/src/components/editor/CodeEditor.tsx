import React, { useState, useEffect, useRef } from 'react';
import { 
  Save, 
  Check, 
  X, 
  Copy, 
  FileCode, 
  RotateCcw,
  Sparkles
} from 'lucide-react';
import { OpenFileTab } from '../../types';
import { highlightCode } from '../../utils/prismHelper';
import { useToast } from '../common/Toast';

interface CodeEditorProps {
  tabs: OpenFileTab[];
  activePath: string;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onContentChange: (path: string, newContent: string) => void;
  onSave: (path: string) => Promise<void>;
}

export const CodeEditor: React.FC<CodeEditorProps> = ({
  tabs,
  activePath,
  onSelectTab,
  onCloseTab,
  onContentChange,
  onSave,
}) => {
  const { toast } = useToast();
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  const [isSaving, setIsSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  const currentTab = tabs.find(t => t.path === activePath) || tabs[0];

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (currentTab) {
          triggerSave();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentTab]);

  const triggerSave = async () => {
    if (!currentTab) return;
    setIsSaving(true);
    await onSave(currentTab.path);
    setIsSaving(false);
    toast(`Saved ${currentTab.name}`, 'success');
  };

  const handleTextareaScroll = () => {
    if (textareaRef.current && preRef.current) {
      preRef.current.scrollTop = textareaRef.current.scrollTop;
      preRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  };

  const handleCursorMove = () => {
    if (!textareaRef.current) return;
    const text = textareaRef.current.value.slice(0, textareaRef.current.selectionStart);
    const lines = text.split('\n');
    setCursorPos({
      line: lines.length,
      col: lines[lines.length - 1].length + 1,
    });
  };

  if (!currentTab) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-studio-bg text-studio-muted select-none">
        <FileCode className="w-12 h-12 text-studio-subtle/50 mb-3" />
        <p className="text-sm font-medium">No file open in editor</p>
        <p className="text-xs text-studio-subtle mt-1">Select a file from the explorer on the left</p>
      </div>
    );
  }

  const lines = currentTab.content.split('\n');
  const lineNumbers = lines.map((_, i) => i + 1);
  const highlightedHtml = highlightCode(currentTab.content, currentTab.language);

  return (
    <div className="flex-1 flex flex-col h-full bg-[#090a10] overflow-hidden">
      {/* File Tabs Bar */}
      <div className="h-10 bg-studio-panel border-b border-studio-border flex items-center justify-between px-2 shrink-0 select-none overflow-x-auto">
        <div className="flex items-center gap-1">
          {tabs.map(tab => {
            const isActive = tab.path === activePath;
            return (
              <div
                key={tab.path}
                onClick={() => onSelectTab(tab.path)}
                className={`group flex items-center gap-2 px-3 py-1.5 rounded-t-lg border-t-2 text-xs font-mono transition-all cursor-pointer ${
                  isActive
                    ? 'bg-[#090a10] border-indigo-500 text-slate-100 font-semibold'
                    : 'bg-studio-panel/50 border-transparent text-studio-muted hover:bg-studio-card/80 hover:text-slate-300'
                }`}
              >
                <span>{tab.name}</span>
                {tab.isDirty ? (
                  <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" title="Unsaved changes" />
                ) : null}
                <button
                  onClick={e => {
                    e.stopPropagation();
                    onCloseTab(tab.path);
                  }}
                  className="p-0.5 rounded hover:bg-white/10 text-studio-subtle hover:text-white transition-colors ml-1"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>

        {/* Action Buttons in Tabs Bar */}
        <div className="flex items-center gap-2 pr-2">
          <button
            onClick={triggerSave}
            disabled={!currentTab.isDirty || isSaving}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              currentTab.isDirty
                ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-glow-indigo'
                : 'text-studio-subtle bg-white/5 opacity-50 cursor-not-allowed'
            }`}
          >
            <Save className="w-3 h-3" />
            <span>{isSaving ? 'Saving...' : 'Save (Ctrl+S)'}</span>
          </button>
        </div>
      </div>

      {/* Breadcrumb Path Bar */}
      <div className="h-7 px-4 bg-studio-panel/40 border-b border-studio-border/50 flex items-center justify-between text-[11px] font-mono text-studio-subtle shrink-0">
        <div className="flex items-center gap-1 truncate">
          <span>antigravity</span>
          <span>/</span>
          {currentTab.path.split('/').map((seg, i, arr) => (
            <React.Fragment key={i}>
              <span className={i === arr.length - 1 ? 'text-cyan-400 font-medium' : ''}>{seg}</span>
              {i < arr.length - 1 && <span>/</span>}
            </React.Fragment>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {currentTab.isDirty ? (
            <span className="text-amber-400 font-medium flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              ● unsaved
            </span>
          ) : (
            <span className="text-emerald-400 font-medium flex items-center gap-1">
              <Check className="w-3 h-3" />
              ✔ saved
            </span>
          )}
        </div>
      </div>

      {/* Editor Body with Line Numbers & Syntax Overlay */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Line Numbers Gutter */}
        <div className="w-12 py-3 bg-studio-panel/30 border-r border-studio-border/40 select-none text-right pr-3 font-mono text-xs text-studio-subtle shrink-0 overflow-hidden leading-6">
          {lineNumbers.map(n => (
            <div key={n} className={n === cursorPos.line ? 'text-indigo-400 font-semibold' : ''}>
              {n}
            </div>
          ))}
        </div>

        {/* Code Content Area */}
        <div className="flex-1 relative overflow-hidden">
          {/* Syntax Highlighted Render (Underlay) */}
          <pre
            ref={preRef}
            aria-hidden="true"
            className="absolute inset-0 p-3 m-0 font-mono text-xs leading-6 overflow-hidden pointer-events-none select-none text-slate-300 whitespace-pre"
          >
            <code dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
          </pre>

          {/* Editable Textarea (Transparent Overlay) */}
          <textarea
            ref={textareaRef}
            value={currentTab.content}
            onChange={e => {
              onContentChange(currentTab.path, e.target.value);
              handleCursorMove();
            }}
            onScroll={handleTextareaScroll}
            onKeyUp={handleCursorMove}
            onClick={handleCursorMove}
            spellCheck={false}
            className="absolute inset-0 p-3 m-0 font-mono text-xs leading-6 bg-transparent text-transparent caret-cyan-400 outline-none resize-none whitespace-pre overflow-auto font-normal"
            style={{ tabSize: 2 }}
          />
        </div>
      </div>

      {/* Editor Bottom Status Info */}
      <div className="h-6 px-4 bg-studio-panel border-t border-studio-border flex items-center justify-between text-[11px] font-mono text-studio-subtle shrink-0 select-none">
        <div className="flex items-center gap-3">
          <span>Ln {cursorPos.line}, Col {cursorPos.col}</span>
          <span>•</span>
          <span>{lines.length} lines</span>
          <span>•</span>
          <span>{currentTab.content.length} characters</span>
        </div>

        <div className="flex items-center gap-3">
          <span className="uppercase text-cyan-400">{currentTab.language}</span>
          <span>•</span>
          <span>UTF-8</span>
        </div>
      </div>
    </div>
  );
};
