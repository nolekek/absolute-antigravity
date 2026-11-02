import React, { useState } from 'react';
import { FileCode, GitBranch, Sidebar, Columns } from 'lucide-react';
import { FileTreeNode, OpenFileTab, GitDiffFile } from '../../types';
import { FileTree } from './FileTree';
import { CodeEditor } from './CodeEditor';
import { GitDiffView } from './GitDiffView';

interface EditorModuleProps {
  tree: FileTreeNode[];
  tabs: OpenFileTab[];
  activePath: string;
  diffs: GitDiffFile[];
  onSelectFile: (path: string) => void;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onContentChange: (path: string, newContent: string) => void;
  onSave: (path: string) => Promise<void>;
  onRefreshFs: () => void;
  onRefreshDiff: () => void;
}

export const EditorModule: React.FC<EditorModuleProps> = ({
  tree,
  tabs,
  activePath,
  diffs,
  onSelectFile,
  onSelectTab,
  onCloseTab,
  onContentChange,
  onSave,
  onRefreshFs,
  onRefreshDiff,
}) => {
  const [subTab, setSubTab] = useState<'editor' | 'diff'>('editor');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="flex flex-col h-full bg-studio-bg overflow-hidden">
      {/* Module Sub-Header */}
      <div className="h-10 px-4 bg-studio-panel/80 border-b border-studio-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title="Toggle File Explorer"
            className="p-1 rounded hover:bg-white/10 text-studio-muted hover:text-white transition-colors cursor-pointer"
          >
            <Sidebar className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-1 bg-studio-card/80 p-0.5 rounded-lg border border-studio-border/60">
            <button
              onClick={() => setSubTab('editor')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                subTab === 'editor'
                  ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40'
                  : 'text-studio-muted hover:text-white'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>Editor</span>
            </button>

            <button
              onClick={() => setSubTab('diff')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                subTab === 'diff'
                  ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40'
                  : 'text-studio-muted hover:text-white'
              }`}
            >
              <GitBranch className="w-3.5 h-3.5" />
              <span>Git Diff ({diffs.length})</span>
            </button>
          </div>
        </div>

        <div className="text-xs text-studio-subtle font-mono hidden sm:inline">
          Workspace: antigravityBUTmultiacc
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {sidebarOpen && subTab === 'editor' && (
          <FileTree
            tree={tree}
            onSelectFile={onSelectFile}
            selectedPath={activePath}
            onRefresh={onRefreshFs}
          />
        )}

        {subTab === 'editor' ? (
          <CodeEditor
            tabs={tabs}
            activePath={activePath}
            onSelectTab={onSelectTab}
            onCloseTab={onCloseTab}
            onContentChange={onContentChange}
            onSave={onSave}
          />
        ) : (
          <GitDiffView
            diffs={diffs}
            onRefresh={onRefreshDiff}
            onOpenInEditor={file => {
              onSelectFile(file);
              setSubTab('editor');
            }}
          />
        )}
      </div>
    </div>
  );
};
