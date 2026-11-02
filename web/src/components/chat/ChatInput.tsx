import React, { useState, useRef, useEffect } from 'react';
import { 
  Send, 
  Square, 
  Terminal, 
  Paperclip, 
  Sparkles, 
  Command, 
  Slash, 
  Cpu, 
  Layers, 
  RefreshCw 
} from 'lucide-react';
import { ModelId } from '../../types';

interface ChatInputProps {
  onSendMessage: (text: string) => void;
  isLoading: boolean;
  onStop: () => void;
  selectedModel: ModelId;
  onSelectSlashCommand: (command: string) => void;
}

interface SlashCommandItem {
  cmd: string;
  desc: string;
  icon: any;
}

const SLASH_COMMANDS: SlashCommandItem[] = [
  { cmd: '/preset', desc: 'Switch active Antigravity preset (/preset orchestrator|web|qa)', icon: Layers },
  { cmd: '/slot', desc: 'Switch active account slot (/slot 1|2|3|4)', icon: RefreshCw },
  { cmd: '/clear', desc: 'Clear conversation history and reset context', icon: Terminal },
  { cmd: '/file', desc: 'Reference workspace file into prompt context', icon: Command },
  { cmd: '/help', desc: 'Display all available Antigravity Studio commands', icon: Sparkles },
];

export const ChatInput: React.FC<ChatInputProps> = ({
  onSendMessage,
  isLoading,
  onStop,
  selectedModel,
  onSelectSlashCommand,
}) => {
  const [input, setInput] = useState('');
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [filteredSlash, setFilteredSlash] = useState<SlashCommandItem[]>(SLASH_COMMANDS);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }

    if (input.startsWith('/')) {
      const query = input.slice(1).toLowerCase();
      const filtered = SLASH_COMMANDS.filter(s => s.cmd.toLowerCase().includes(query) || s.desc.toLowerCase().includes(query));
      setFilteredSlash(filtered);
      setSlashMenuOpen(filtered.length > 0);
    } else {
      setSlashMenuOpen(false);
    }
  }, [input]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (e.key === 'Escape') {
      setSlashMenuOpen(false);
    }
  };

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    const text = input.trim();
    setInput('');
    setSlashMenuOpen(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    onSendMessage(text);
  };

  const chooseSlash = (cmd: string) => {
    setInput(cmd + ' ');
    setSlashMenuOpen(false);
    textareaRef.current?.focus();
    onSelectSlashCommand(cmd);
  };

  return (
    <div className="relative p-3 sm:p-4 bg-studio-panel border-t border-studio-border">
      {/* Slash Commands Auto-suggest Popup */}
      {slashMenuOpen && (
        <div className="absolute bottom-full left-4 right-4 sm:left-6 sm:right-6 mb-2 bg-studio-panel/95 backdrop-blur-xl border border-studio-border rounded-xl shadow-2xl p-2 z-50 animate-fade-in max-h-56 overflow-y-auto">
          <div className="px-2 py-1 text-[11px] font-semibold text-studio-subtle uppercase tracking-wider border-b border-studio-border/60 mb-1 flex items-center gap-1.5">
            <Slash className="w-3 h-3 text-cyan-400" />
            Quick Slash Actions
          </div>
          <div className="flex flex-col gap-1">
            {filteredSlash.map(s => {
              const IconComp = s.icon;
              return (
                <button
                  key={s.cmd}
                  onClick={() => chooseSlash(s.cmd)}
                  className="flex items-center justify-between p-2 rounded-lg hover:bg-white/5 text-left text-xs transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 group-hover:bg-indigo-500/20">
                      <IconComp className="w-3.5 h-3.5" />
                    </div>
                    <span className="font-mono font-bold text-slate-100">{s.cmd}</span>
                  </div>
                  <span className="text-[11px] text-studio-muted">{s.desc}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Input Box Container */}
      <div className="relative rounded-2xl bg-studio-card/90 border border-studio-border focus-within:border-indigo-500/60 focus-within:ring-2 focus-within:ring-indigo-500/20 transition-all shadow-inner">
        <textarea
          ref={textareaRef}
          rows={1}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask Cascade or type / for slash commands (Shift+Enter for newline)..."
          className="w-full bg-transparent text-slate-100 placeholder-studio-subtle text-xs sm:text-sm p-3.5 pr-20 outline-none resize-none min-h-[46px] max-h-[180px] leading-relaxed font-sans"
        />

        {/* Action Buttons inside Input Box */}
        <div className="flex items-center justify-between px-3 pb-2.5 pt-1 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-studio-subtle flex items-center gap-1">
              <Cpu className="w-3 h-3 text-cyan-400" />
              {selectedModel}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {isLoading ? (
              <button
                onClick={onStop}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-medium text-xs transition-all shadow-lg cursor-pointer"
              >
                <Square className="w-3 h-3 fill-current" />
                <span>Stop</span>
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white transition-all shadow-glow-indigo disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
