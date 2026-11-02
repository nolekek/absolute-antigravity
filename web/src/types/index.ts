export type ModelId = 
  | 'gemini-3.8-flash-high'
  | 'gemini-2.5-pro'
  | 'claude-sonnet-4-6'
  | 'claude-opus-4-6-thinking'
  | 'gemini-2.5-flash';

export interface ModelInfo {
  id: ModelId;
  name: string;
  badge: string;
  desc: string;
  provider: 'google' | 'anthropic';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinking?: string;
  thinkingDurationSec?: number;
  tokens?: number;
  timestamp: string;
  model?: string;
  proposedDiff?: {
    file: string;
    additions: number;
    deletions: number;
    diff: string;
  };
  isStreaming?: boolean;
}

export interface SlotAccount {
  slot: number;
  email: string;
  isActive: boolean;
  isLoggedIn: boolean;
  status: 'active' | 'cooling' | 'exhausted' | 'ready';
  quotaPercent: number;
  limitDesc: string;
  resetIn?: string;
  lastUsed?: string;
}

export interface PresetItem {
  id: string;
  name: string;
  icon: string;
  description: string;
  skills: string[];
  adjacent_presets?: string[];
}

export interface ServerState {
  ok: boolean;
  activeSlot: number;
  activePreset: string;
  languageServerPort: number;
  uptime: number;
  isBotActive: boolean;
  autoFailover: boolean;
  totalTokensSession?: number;
  accounts: SlotAccount[];
  lastError?: string;
}

export interface FileTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  children?: FileTreeNode[];
  extension?: string;
}

export interface OpenFileTab {
  path: string;
  name: string;
  content: string;
  originalContent: string;
  isDirty: boolean;
  language: string;
}

export interface GitDiffFile {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  diff: string;
}

export interface SystemLogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  source: string;
}

export type ActiveTab = 'chat' | 'editor' | 'terminal' | 'presets' | 'accounts' | 'logs';
