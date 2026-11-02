import React, { useState } from 'react';
import { 
  Folder, 
  FolderOpen, 
  FileCode, 
  FileJson, 
  FileText, 
  File, 
  ChevronRight, 
  ChevronDown, 
  RefreshCw, 
  Search 
} from 'lucide-react';
import { FileTreeNode } from '../../types';

interface FileTreeProps {
  tree: FileTreeNode[];
  onSelectFile: (path: string) => void;
  selectedPath: string;
  onRefresh: () => void;
}

const getFileIcon = (fileName: string) => {
  if (fileName.endsWith('.tsx') || fileName.endsWith('.ts') || fileName.endsWith('.js') || fileName.endsWith('.jsx')) {
    return <FileCode className="w-4 h-4 text-cyan-400 shrink-0" />;
  }
  if (fileName.endsWith('.json')) {
    return <FileJson className="w-4 h-4 text-amber-400 shrink-0" />;
  }
  if (fileName.endsWith('.md')) {
    return <FileText className="w-4 h-4 text-indigo-400 shrink-0" />;
  }
  if (fileName.endsWith('.css')) {
    return <FileCode className="w-4 h-4 text-blue-400 shrink-0" />;
  }
  if (fileName.endsWith('.yaml') || fileName.endsWith('.yml')) {
    return <FileText className="w-4 h-4 text-rose-400 shrink-0" />;
  }
  return <File className="w-4 h-4 text-slate-400 shrink-0" />;
};

const TreeNode: React.FC<{
  node: FileTreeNode;
  onSelectFile: (path: string) => void;
  selectedPath: string;
  depth: number;
}> = ({ node, onSelectFile, selectedPath, depth }) => {
  const [isOpen, setIsOpen] = useState(true);

  if (node.isDirectory) {
    return (
      <div>
        <button
          onClick={() => setIsOpen(!isOpen)}
          style={{ paddingLeft: `${depth * 12 + 6}px` }}
          className="w-full flex items-center gap-1.5 py-1 px-2 rounded hover:bg-white/5 text-xs text-slate-300 hover:text-white transition-colors text-left cursor-pointer"
        >
          {isOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-studio-subtle shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-studio-subtle shrink-0" />
          )}
          {isOpen ? (
            <FolderOpen className="w-4 h-4 text-indigo-400 shrink-0" />
          ) : (
            <Folder className="w-4 h-4 text-indigo-400/80 shrink-0" />
          )}
          <span className="font-medium truncate">{node.name}</span>
        </button>

        {isOpen && node.children && (
          <div>
            {node.children.map(child => (
              <TreeNode
                key={child.path}
                node={child}
                onSelectFile={onSelectFile}
                selectedPath={selectedPath}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const isSelected = selectedPath === node.path;

  return (
    <button
      onClick={() => onSelectFile(node.path)}
      style={{ paddingLeft: `${depth * 12 + 20}px` }}
      className={`w-full flex items-center gap-2 py-1 px-2 rounded text-xs transition-all text-left cursor-pointer ${
        isSelected
          ? 'bg-indigo-600/20 text-indigo-200 border-l-2 border-indigo-500 font-semibold'
          : 'text-studio-muted hover:text-slate-200 hover:bg-white/5'
      }`}
    >
      {getFileIcon(node.name)}
      <span className="truncate">{node.name}</span>
    </button>
  );
};

export const FileTree: React.FC<FileTreeProps> = ({
  tree,
  onSelectFile,
  selectedPath,
  onRefresh,
}) => {
  const [filter, setFilter] = useState('');

  const filterTree = (nodes: FileTreeNode[]): FileTreeNode[] => {
    if (!filter.trim()) return nodes;
    const lower = filter.toLowerCase();

    return nodes
      .map(node => {
        if (node.isDirectory) {
          const matchingChildren = node.children ? filterTree(node.children) : [];
          if (matchingChildren.length > 0 || node.name.toLowerCase().includes(lower)) {
            return { ...node, children: matchingChildren };
          }
          return null;
        }
        return node.name.toLowerCase().includes(lower) ? node : null;
      })
      .filter(Boolean) as FileTreeNode[];
  };

  const filteredTree = filterTree(tree);

  return (
    <div className="flex flex-col h-full bg-studio-panel border-r border-studio-border w-64 shrink-0 select-none">
      {/* File Explorer Header */}
      <div className="h-10 px-3 border-b border-studio-border/80 flex items-center justify-between text-xs font-semibold text-slate-200">
        <span className="uppercase tracking-wider text-[11px] text-studio-subtle font-mono">
          Explorer
        </span>
        <button
          onClick={onRefresh}
          title="Refresh Workspace Files"
          className="p-1 rounded hover:bg-white/10 text-studio-muted hover:text-white transition-colors cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Quick Search */}
      <div className="p-2 border-b border-studio-border/40">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-studio-card/80 border border-studio-border text-xs text-studio-muted focus-within:border-indigo-500/50">
          <Search className="w-3.5 h-3.5 text-studio-subtle shrink-0" />
          <input
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Search files..."
            className="w-full bg-transparent text-slate-200 placeholder-studio-subtle outline-none text-xs"
          />
        </div>
      </div>

      {/* Tree Content */}
      <div className="flex-1 overflow-y-auto p-1 py-2 space-y-0.5">
        {filteredTree.map(node => (
          <TreeNode
            key={node.path}
            node={node}
            onSelectFile={onSelectFile}
            selectedPath={selectedPath}
            depth={0}
          />
        ))}
      </div>
    </div>
  );
};
