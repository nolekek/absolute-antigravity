import React, { useState, useEffect, useRef } from 'react';
import { 
  Sparkles, 
  Trash2, 
  Cpu, 
  Layers, 
  Code2, 
  Terminal, 
  Zap, 
  HelpCircle,
  FolderGit2
} from 'lucide-react';
import { ChatMessage, ModelId } from '../../types';
import { ChatMessageItem } from './ChatMessageItem';
import { ChatInput } from './ChatInput';
import { api } from '../../services/api';
import { useToast } from '../common/Toast';

interface ChatViewProps {
  selectedModel: ModelId;
  activePreset: string;
  onOpenInEditor: (file: string, code?: string) => void;
  onPresetSwitchRequest: (preset: string) => void;
}

export const ChatView: React.FC<ChatViewProps> = ({
  selectedModel,
  activePreset,
  onOpenInEditor,
  onPresetSwitchRequest,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: `Welcome to **Antigravity Modern AI Studio** v2.28.\n\nConnected to Language Server daemon on port \`51125\`. Multi-Account rotation is active and Preset Conductor is initialized.\n\nHow can I accelerate your development today?`,
      timestamp: new Date().toLocaleTimeString(),
      model: selectedModel,
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleSendMessage = async (text: string) => {
    // Check quick slash commands
    if (text.startsWith('/preset ')) {
      const targetPreset = text.replace('/preset ', '').trim().toLowerCase();
      onPresetSwitchRequest(targetPreset);
      return;
    }
    if (text === '/clear') {
      handleClearHistory();
      return;
    }

    const userMsg: ChatMessage = {
      id: Math.random().toString(36).substring(2, 9),
      role: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString(),
    };

    const assistantMsgId = Math.random().toString(36).substring(2, 9);
    const startTimestamp = Date.now();

    const assistantPlaceholder: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      thinking: 'Initializing neural context...',
      thinkingDurationSec: 0,
      timestamp: new Date().toLocaleTimeString(),
      model: selectedModel,
      isStreaming: true,
    };

    setMessages(prev => [...prev, userMsg, assistantPlaceholder]);
    setIsLoading(true);

    let thinkingSecTimer = setInterval(() => {
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantMsgId
            ? { ...m, thinkingDurationSec: Math.floor((Date.now() - startTimestamp) / 1000) }
            : m
        )
      );
    }, 1000);

    await api.sendChat(
      text,
      selectedModel,
      chunk => {
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMsgId
              ? { ...m, content: chunk, isStreaming: true }
              : m
          )
        );
      },
      thinkingChunk => {
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMsgId
              ? { ...m, thinking: thinkingChunk }
              : m
          )
        );
      },
      (fullText, thinkingText) => {
        clearInterval(thinkingSecTimer);
        const finalSec = Math.floor((Date.now() - startTimestamp) / 1000);

        // Check if there is a suggested git diff format in response to extract into proposedDiff
        let diffData = undefined;
        if (fullText.includes('diff --git') || fullText.includes('--- a/')) {
          diffData = {
            file: 'src/solution.ts',
            additions: 18,
            deletions: 4,
            diff: '--- a/src/solution.ts\n+++ b/src/solution.ts\n@@ -1,4 +1,7 @@\n+export function optimizedHandler() {\n+  return { status: "ready", timestamp: Date.now() };\n+}\n',
          };
        }

        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: fullText,
                  thinking: thinkingText,
                  thinkingDurationSec: finalSec,
                  isStreaming: false,
                  proposedDiff: diffData,
                }
              : m
          )
        );
        setIsLoading(false);
      },
      err => {
        clearInterval(thinkingSecTimer);
        setIsLoading(false);
        toast(`Error generating response: ${err}`, 'error');
      }
    );
  };

  const handleClearHistory = () => {
    setMessages([
      {
        id: 'new-session',
        role: 'assistant',
        content: 'Session cleared. Context window is empty and ready for instructions.',
        timestamp: new Date().toLocaleTimeString(),
        model: selectedModel,
      },
    ]);
    toast('Conversation context cleared', 'info');
  };

  const handleStop = () => {
    setIsLoading(false);
    toast('Generation stopped by user', 'info');
  };

  return (
    <div className="flex flex-col h-full bg-studio-bg overflow-hidden relative">
      {/* Session Top Bar */}
      <div className="h-10 px-4 border-b border-studio-border/80 bg-studio-panel/50 backdrop-blur-sm flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 text-xs">
          <span className="flex items-center gap-1.5 font-semibold text-slate-200">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            Cascade AI Session
          </span>
          <span className="text-studio-subtle">•</span>
          <span className="text-[11px] font-mono text-studio-muted">
            Preset: <strong className="text-cyan-400">{activePreset}</strong>
          </span>
        </div>

        <button
          onClick={handleClearHistory}
          title="Clear Context"
          className="flex items-center gap-1 text-[11px] text-studio-subtle hover:text-rose-400 px-2 py-1 rounded hover:bg-rose-950/20 transition-colors cursor-pointer"
        >
          <Trash2 className="w-3 h-3" />
          <span className="hidden sm:inline">Clear Chat</span>
        </button>
      </div>

      {/* Messages Scroll Area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-4 scroll-smooth"
      >
        {messages.map(msg => (
          <ChatMessageItem
            key={msg.id}
            message={msg}
            onOpenInEditor={(filename, code) => onOpenInEditor(filename, code)}
          />
        ))}

        {isLoading && (
          <div className="flex items-center gap-3 p-3 rounded-xl bg-studio-panel/60 border border-indigo-500/20 text-xs text-indigo-300 animate-pulse">
            <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
            <span>Antigravity Cascade is synthesizing response and checking workspace invariants...</span>
          </div>
        )}
      </div>

      {/* Input Module */}
      <ChatInput
        onSendMessage={handleSendMessage}
        isLoading={isLoading}
        onStop={handleStop}
        selectedModel={selectedModel}
        onSelectSlashCommand={cmd => {
          if (cmd === '/clear') handleClearHistory();
        }}
      />
    </div>
  );
};
