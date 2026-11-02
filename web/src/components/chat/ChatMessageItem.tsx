import React, { useState } from 'react';
import { 
  Bot, 
  User, 
  ChevronRight, 
  ChevronDown, 
  Copy, 
  Check, 
  FileCode, 
  Clock, 
  Sparkles, 
  Cpu, 
  TerminalSquare
} from 'lucide-react';
import { ChatMessage } from '../../types';
import { highlightCode } from '../../utils/prismHelper';
import { DiffVisualizer } from './DiffVisualizer';
import { useToast } from '../common/Toast';

interface ChatMessageItemProps {
  message: ChatMessage;
  onOpenInEditor: (filename: string, codeContent?: string) => void;
}

export const ChatMessageItem: React.FC<ChatMessageItemProps> = ({ message, onOpenInEditor }) => {
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [copiedCodeIdx, setCopiedCodeIdx] = useState<number | null>(null);
  const { toast } = useToast();

  const isUser = message.role === 'user';

  const handleCopy = (code: string, idx: number) => {
    navigator.clipboard.writeText(code);
    setCopiedCodeIdx(idx);
    toast('Code copied to clipboard', 'info');
    setTimeout(() => setCopiedCodeIdx(null), 2000);
  };

  // Helper to parse content into text and fenced code blocks
  const renderFormattedContent = (content: string) => {
    const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;
    let blockIndex = 0;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      // Preceding text
      if (match.index > lastIndex) {
        const textChunk = content.slice(lastIndex, match.index);
        parts.push(
          <div key={`text-${lastIndex}`} className="whitespace-pre-wrap leading-relaxed my-1.5">
            {renderInlineMarkdown(textChunk)}
          </div>
        );
      }

      const language = match[1] || 'typescript';
      const code = match[2];
      const curIdx = blockIndex++;

      const highlightedHtml = highlightCode(code, language);

      parts.push(
        <div
          key={`code-${match.index}`}
          className="my-3 rounded-xl border border-studio-border bg-[#0b0c14] overflow-hidden shadow-md group"
        >
          {/* Code Header Bar */}
          <div className="flex items-center justify-between px-3.5 py-1.5 bg-studio-panel/90 border-b border-studio-border text-xs text-studio-muted">
            <span className="font-mono text-cyan-400 font-semibold uppercase text-[11px] tracking-wider">
              {language}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onOpenInEditor(`snippet.${language}`, code)}
                className="flex items-center gap-1.5 px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition-all text-[11px] cursor-pointer"
                title="Open snippet in Studio Editor"
              >
                <FileCode className="w-3.5 h-3.5 text-indigo-400" />
                <span>Open in Editor</span>
              </button>

              <button
                onClick={() => handleCopy(code, curIdx)}
                className="flex items-center gap-1.5 px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition-all text-[11px] cursor-pointer"
                title="Copy code"
              >
                {copiedCodeIdx === curIdx ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-studio-muted" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Code Body */}
          <div className="p-3.5 overflow-x-auto text-xs leading-relaxed font-mono select-text bg-[#090a10]">
            <pre className={`language-${language} m-0`}>
              <code dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
            </pre>
          </div>
        </div>
      );

      lastIndex = match.index + match[0].length;
    }

    // Remaining text
    if (lastIndex < content.length) {
      parts.push(
        <div key={`text-${lastIndex}`} className="whitespace-pre-wrap leading-relaxed my-1.5">
          {renderInlineMarkdown(content.slice(lastIndex))}
        </div>
      );
    }

    return parts;
  };

  const renderInlineMarkdown = (text: string) => {
    // Bold **text**
    const boldRegex = /\*\*(.*?)\*\*/g;
    const parts: (string | React.ReactNode)[] = [];
    let last = 0;
    let m;
    while ((m = boldRegex.exec(text)) !== null) {
      if (m.index > last) parts.push(text.slice(last, m.index));
      parts.push(<strong key={m.index} className="font-semibold text-white">{m[1]}</strong>);
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
  };

  return (
    <div
      className={`flex gap-3 sm:gap-4 p-3.5 sm:p-5 rounded-2xl transition-all ${
        isUser
          ? 'bg-studio-panel/50 border border-transparent'
          : 'bg-studio-panel/90 border border-studio-border/70 shadow-lg'
      }`}
    >
      {/* Avatar */}
      <div className="shrink-0">
        {isUser ? (
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-slate-700 to-slate-600 flex items-center justify-center text-slate-200 shadow-md">
            <User className="w-4 h-4" />
          </div>
        ) : (
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 p-[1px] shadow-glow-indigo flex items-center justify-center">
            <div className="w-full h-full bg-studio-panel rounded-[11px] flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-cyan-400" />
            </div>
          </div>
        )}
      </div>

      {/* Content Area */}
      <div className="flex-1 min-w-0">
        {/* Header Metadata */}
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-xs sm:text-sm text-slate-100">
              {isUser ? 'You' : 'Antigravity Cascade'}
            </span>
            {message.model && !isUser && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                {message.model}
              </span>
            )}
          </div>
          <span className="text-[11px] font-mono text-studio-subtle">{message.timestamp}</span>
        </div>

        {/* Collapsible Thinking Block (CoT Accordion) */}
        {message.thinking && !isUser && (
          <div className="my-2 rounded-xl border border-indigo-500/30 bg-indigo-950/20 overflow-hidden text-xs">
            <button
              onClick={() => setThinkingOpen(!thinkingOpen)}
              className="w-full flex items-center justify-between p-2.5 hover:bg-indigo-900/20 transition-colors text-indigo-300 cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Cpu className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                <span className="font-semibold tracking-wide">
                  Thinking Process {message.isStreaming && '(thinking...)'}
                </span>
                {message.thinkingDurationSec && (
                  <span className="text-[10px] font-mono text-studio-muted flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {message.thinkingDurationSec}s
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 text-[11px] text-studio-muted">
                <span>{thinkingOpen ? 'Hide' : 'Expand'}</span>
                {thinkingOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </div>
            </button>

            {thinkingOpen && (
              <div className="p-3 border-t border-indigo-500/20 font-mono text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap max-h-60 overflow-y-auto bg-black/40">
                {message.thinking}
              </div>
            )}
          </div>
        )}

        {/* Message Body */}
        <div className="text-xs sm:text-sm text-slate-200 select-text">
          {renderFormattedContent(message.content)}
        </div>

        {/* Proposed Unified Diff Visualizer */}
        {message.proposedDiff && (
          <DiffVisualizer
            file={message.proposedDiff.file}
            additions={message.proposedDiff.additions}
            deletions={message.proposedDiff.deletions}
            diff={message.proposedDiff.diff}
            onOpenInEditor={file => onOpenInEditor(file)}
          />
        )}
      </div>
    </div>
  );
};
