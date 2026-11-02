import React, { useState, useEffect } from 'react';
import { ToastProvider, useToast } from './components/common/Toast';
import { Navbar } from './components/common/Navbar';
import { StatusBar } from './components/common/StatusBar';
import { PinModal } from './components/common/PinModal';
import { ChatView } from './components/chat/ChatView';
import { EditorModule } from './components/editor/EditorModule';
import { TerminalModule } from './components/terminal/TerminalModule';
import { PresetsHub } from './components/presets/PresetsHub';
import { AccountsCarousel } from './components/accounts/AccountsCarousel';
import { LogsViewer } from './components/logs/LogsViewer';

import { 
  ModelId, 
  ActiveTab, 
  ServerState, 
  PresetItem, 
  FileTreeNode, 
  OpenFileTab, 
  GitDiffFile, 
  SystemLogEntry 
} from './types';
import { api } from './services/api';

const MainAppContent: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('chat');
  const [selectedModel, setSelectedModel] = useState<ModelId>('gemini-3.8-flash-high');
  const [pinModalOpen, setPinModalOpen] = useState(false);
  
  // Server State
  const [serverState, setServerState] = useState<ServerState>({
    ok: true,
    activeSlot: 1,
    activePreset: 'web',
    languageServerPort: 51125,
    uptime: 3600,
    isBotActive: true,
    autoFailover: true,
    accounts: [],
  });

  const [presets, setPresets] = useState<PresetItem[]>([]);
  const [fsTree, setFsTree] = useState<FileTreeNode[]>([]);
  const [openTabs, setOpenTabs] = useState<OpenFileTab[]>([
    {
      path: 'web/src/App.tsx',
      name: 'App.tsx',
      content: `// Antigravity AI Studio v2.28\n// Modern React & Vite Single-File Architecture\n\nexport function StudioApp() {\n  console.log("Antigravity AI Studio loaded.");\n  return <div>Ready</div>;\n}\n`,
      originalContent: `// Antigravity AI Studio v2.28\n// Modern React & Vite Single-File Architecture\n\nexport function StudioApp() {\n  console.log("Antigravity AI Studio loaded.");\n  return <div>Ready</div>;\n}\n`,
      isDirty: false,
      language: 'typescript',
    },
  ]);
  const [activeFilePath, setActiveFilePath] = useState('web/src/App.tsx');
  const [gitDiffs, setGitDiffs] = useState<GitDiffFile[]>([]);
  const [systemLogs, setSystemLogs] = useState<SystemLogEntry[]>([]);

  const { toast } = useToast();

  useEffect(() => {
    // Initial data hydration
    initData();

    // Check if PIN is needed
    if (!api.getPin()) {
      setPinModalOpen(true);
    }

    // Keyboard shortcuts (Ctrl+1..6)
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '1') { e.preventDefault(); setActiveTab('chat'); }
        else if (e.key === '2') { e.preventDefault(); setActiveTab('editor'); }
        else if (e.key === '3') { e.preventDefault(); setActiveTab('terminal'); }
        else if (e.key === '4') { e.preventDefault(); setActiveTab('presets'); }
        else if (e.key === '5') { e.preventDefault(); setActiveTab('accounts'); }
        else if (e.key === '6') { e.preventDefault(); setActiveTab('logs'); }
      }
    };
    window.addEventListener('keydown', handleGlobalShortcuts);
    return () => window.removeEventListener('keydown', handleGlobalShortcuts);
  }, []);

  const initData = async () => {
    try {
      const [state, presetList, tree, diffs, logs] = await Promise.all([
        api.getState(),
        api.getPresets(),
        api.getFsTree(),
        api.getGitDiff(),
        api.getLogs(),
      ]);
      setServerState(state);
      setPresets(presetList);
      setFsTree(tree);
      setGitDiffs(diffs);
      setSystemLogs(logs);
    } catch (_) {}
  };

  const handleSelectFile = async (path: string) => {
    const existing = openTabs.find(t => t.path === path);
    if (existing) {
      setActiveFilePath(path);
      setActiveTab('editor');
      return;
    }

    const content = await api.readFile(path);
    const fileName = path.split('/').pop() || path;
    const ext = fileName.split('.').pop() || '';
    let language = 'typescript';
    if (ext === 'json') language = 'json';
    else if (ext === 'css') language = 'css';
    else if (ext === 'py') language = 'python';
    else if (ext === 'yaml' || ext === 'yml') language = 'yaml';

    const newTab: OpenFileTab = {
      path,
      name: fileName,
      content,
      originalContent: content,
      isDirty: false,
      language,
    };

    setOpenTabs(prev => [...prev, newTab]);
    setActiveFilePath(path);
    setActiveTab('editor');
  };

  const handleOpenSnippetInEditor = (filename: string, codeContent?: string) => {
    const virtualPath = `snippets/${filename}`;
    const existing = openTabs.find(t => t.path === virtualPath);
    const content = codeContent || '// Code snippet from Cascade\n';
    const ext = filename.split('.').pop() || 'typescript';

    if (existing) {
      setActiveFilePath(virtualPath);
    } else {
      const newTab: OpenFileTab = {
        path: virtualPath,
        name: filename,
        content,
        originalContent: content,
        isDirty: false,
        language: ext,
      };
      setOpenTabs(prev => [...prev, newTab]);
      setActiveFilePath(virtualPath);
    }
    setActiveTab('editor');
    toast(`Opened ${filename} in Editor`, 'info');
  };

  const handleCloseTab = (path: string) => {
    const nextTabs = openTabs.filter(t => t.path !== path);
    setOpenTabs(nextTabs);
    if (activeFilePath === path && nextTabs.length > 0) {
      setActiveFilePath(nextTabs[nextTabs.length - 1].path);
    }
  };

  const handleEditorContentChange = (path: string, newContent: string) => {
    setOpenTabs(prev =>
      prev.map(t =>
        t.path === path
          ? { ...t, content: newContent, isDirty: newContent !== t.originalContent }
          : t
      )
    );
  };

  const handleEditorSave = async (path: string) => {
    const tab = openTabs.find(t => t.path === path);
    if (!tab) return;
    await api.writeFile(path, tab.content);
    setOpenTabs(prev =>
      prev.map(t =>
        t.path === path ? { ...t, originalContent: tab.content, isDirty: false } : t
      )
    );
  };

  const handleSwitchPreset = async (presetId: string, overlays: string[]) => {
    await api.switchPreset(presetId, overlays);
    setServerState(prev => ({ ...prev, activePreset: presetId }));
  };

  const handleSwitchSlot = async (slot: number) => {
    await api.switchSlot(slot);
    setServerState(prev => ({ ...prev, activeSlot: slot }));
  };

  const handleCycleSlot = async () => {
    const res = await api.cycleSlot();
    const nextSlot = (serverState.activeSlot % 4) + 1;
    setServerState(prev => ({ ...prev, activeSlot: res.activeSlot || nextSlot }));
  };

  const handleRefreshQuotas = async () => {
    await api.refreshQuotas();
    const freshState = await api.getState();
    setServerState(freshState);
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-studio-bg text-studio-text select-none">
      {/* Top Studio Navbar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        selectedModel={selectedModel}
        setSelectedModel={setSelectedModel}
        activePreset={serverState.activePreset}
        activeSlot={serverState.activeSlot}
        onNewChat={() => setActiveTab('chat')}
        onOpenPinModal={() => setPinModalOpen(true)}
        onCycleSlot={handleCycleSlot}
      />

      {/* Main Studio Viewport */}
      <main className="flex-1 overflow-hidden relative">
        {activeTab === 'chat' && (
          <ChatView
            selectedModel={selectedModel}
            activePreset={serverState.activePreset}
            onOpenInEditor={handleOpenSnippetInEditor}
            onPresetSwitchRequest={preset => handleSwitchPreset(preset, [])}
          />
        )}

        {activeTab === 'editor' && (
          <EditorModule
            tree={fsTree}
            tabs={openTabs}
            activePath={activeFilePath}
            diffs={gitDiffs}
            onSelectFile={handleSelectFile}
            onSelectTab={setActiveFilePath}
            onCloseTab={handleCloseTab}
            onContentChange={handleEditorContentChange}
            onSave={handleEditorSave}
            onRefreshFs={async () => setFsTree(await api.getFsTree())}
            onRefreshDiff={async () => setGitDiffs(await api.getGitDiff())}
          />
        )}

        {activeTab === 'terminal' && <TerminalModule />}

        {activeTab === 'presets' && (
          <PresetsHub
            presets={presets}
            activePreset={serverState.activePreset}
            onSwitchPreset={handleSwitchPreset}
          />
        )}

        {activeTab === 'accounts' && (
          <AccountsCarousel
            accounts={serverState.accounts}
            activeSlot={serverState.activeSlot}
            autoFailover={serverState.autoFailover}
            onSwitchSlot={handleSwitchSlot}
            onCycleSlot={handleCycleSlot}
            onRefreshQuotas={handleRefreshQuotas}
            onToggleAutoFailover={() =>
              setServerState(prev => ({ ...prev, autoFailover: !prev.autoFailover }))
            }
          />
        )}

        {activeTab === 'logs' && (
          <LogsViewer
            logs={systemLogs}
            state={serverState}
            onRefresh={async () => setSystemLogs(await api.getLogs())}
            onClear={() => setSystemLogs([])}
          />
        )}
      </main>

      {/* Bottom Status Bar & Mobile Navigation */}
      <StatusBar
        activePreset={serverState.activePreset}
        activeSlot={serverState.activeSlot}
        serverPort={serverState.languageServerPort}
        isOnline={serverState.ok}
        autoFailover={serverState.autoFailover}
        totalTokensSession={serverState.totalTokensSession}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />

      {/* 6-Digit PIN Authentication Modal */}
      <PinModal
        isOpen={pinModalOpen}
        onSuccess={() => {
          setPinModalOpen(false);
          initData();
        }}
        onClose={() => setPinModalOpen(false)}
      />
    </div>
  );
};

export function App() {
  return (
    <ToastProvider>
      <MainAppContent />
    </ToastProvider>
  );
}

export default App;
