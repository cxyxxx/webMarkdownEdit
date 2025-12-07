
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Icons } from './Icon';
import { EditorFile, FileSystemHandle, FileSystemDirectoryHandle, FileSystemFileHandle } from '../types';
import { fileSystem } from '../services/fileSystem';

interface SidebarProps {
  files: EditorFile[];
  projectFiles: FileSystemHandle[];
  activeFileId: string | null;
  rootDirName?: string;
  rootDirHandle?: FileSystemDirectoryHandle;
  isRecycleBinActive: boolean;
  onFileSelect: (id: string) => void;
  onFileClose: (id: string, e: React.MouseEvent) => void;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onCloseFolder: () => void;
  onProjectFileSelect: (handle: any) => void;
  onCreateFile: (parentHandle?: FileSystemDirectoryHandle) => Promise<void>;
  onCreateFolder: (parentHandle?: FileSystemDirectoryHandle) => Promise<void>;
  onDeleteFile: (name: string, kind: 'file' | 'directory', parentHandle: FileSystemDirectoryHandle) => void;
  onRenameFile: (name: string, kind: 'file' | 'directory', parentHandle: FileSystemDirectoryHandle) => void;
  onToggleRecycleBin: () => void;
  onRestoreFile?: (name: string) => void;
}

// Recursive File Tree Item Component
const FileTreeItem: React.FC<{
  handle: FileSystemHandle;
  parentHandle: FileSystemDirectoryHandle;
  depth: number;
  path: string; // Added path property
  files: EditorFile[];
  activeFileId: string | null;
  onProjectFileSelect: (handle: any) => void;
  onContextMenu: (e: React.MouseEvent, handle: FileSystemHandle, parentHandle: FileSystemDirectoryHandle, refresh?: () => void) => void;
}> = ({ handle, parentHandle, depth, path, files, activeFileId, onProjectFileSelect, onContextMenu }) => {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileSystemHandle[] | null>(null);
  const [loading, setLoading] = useState(false);
  
  // Find the currently active file object
  const activeFile = files.find(f => f.id === activeFileId);
  
  // Identify if this file is currently active by comparing PATHS (not just names)
  // If activeFile.path is undefined (legacy/new file), it won't match, which is correct.
  const isSelected = activeFile && activeFile.path === path;

  const fetchChildren = useCallback(async () => {
    if (handle.kind !== 'directory') return;
    setLoading(true);
    try {
      const entries = await fileSystem.listFiles(handle as FileSystemDirectoryHandle);
      const filtered = entries.filter(i => !i.name.startsWith('.'));
      setChildren(filtered);
    } catch (e) {
      console.error("Failed to list files", e);
    } finally {
      setLoading(false);
    }
  }, [handle]);

  // Expand toggle
  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (handle.kind === 'directory') {
      if (!expanded && !children) {
        await fetchChildren();
      }
      setExpanded(!expanded);
    } else {
      onProjectFileSelect(handle);
    }
  };

  const handleRightClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Pass fetchChildren as refresh callback so context menu can trigger update
    onContextMenu(e, handle, parentHandle, fetchChildren);
  };

  return (
    <div>
      <div 
        onClick={handleClick}
        onContextMenu={handleRightClick}
        style={{ paddingLeft: `${depth * 12 + 10}px` }}
        className={`flex items-center gap-1 py-1 text-sm cursor-pointer border-l-2 border-transparent transition-colors
            ${isSelected 
              ? 'bg-blue-100 dark:bg-[#37373d] text-blue-700 dark:text-white border-blue-500' 
              : 'text-gray-700 dark:text-[#cccccc] hover:bg-gray-200 dark:hover:bg-[#2a2d2e]'}
        `}
        title={path}
      >
        <span className="shrink-0 flex items-center justify-center w-4">
          {handle.kind === 'directory' && (
             expanded ? <Icons.FolderOpen size={14} className="text-yellow-600 dark:text-yellow-500" /> : <Icons.File size={14} className="text-yellow-600 dark:text-yellow-500 rotate-90" style={{ transform: 'rotate(0deg)' }} /> 
          )}
          {handle.kind === 'directory' && !expanded && <Icons.FolderPlus size={14} className="text-yellow-600 dark:text-yellow-500 hidden" />} 
          {handle.kind === 'directory' ? (expanded ? null : null) : <Icons.FileText size={14} className="text-gray-500" />}
        </span>
        
        {handle.kind === 'directory' ? (
           <span className="shrink-0 text-yellow-600 dark:text-yellow-500">
             {expanded ? <Icons.FolderOpen size={14}/> : <Icons.FolderPlus size={14} style={{ fill: 'currentColor', opacity: 0.8 }} />} 
           </span>
        ) : null}

        <span className="truncate select-none">{handle.name}</span>
      </div>
      
      {expanded && handle.kind === 'directory' && (
        <div>
          {loading && <div className="pl-8 text-xs text-gray-500">Loading...</div>}
          {!loading && children && children.map((child, idx) => (
            <FileTreeItem 
              key={child.name + idx}
              handle={child}
              parentHandle={handle as FileSystemDirectoryHandle}
              depth={depth + 1}
              path={`${path}/${child.name}`} // Construct child path
              files={files}
              activeFileId={activeFileId}
              onProjectFileSelect={onProjectFileSelect}
              onContextMenu={onContextMenu}
            />
          ))}
          {!loading && children && children.length === 0 && (
             <div style={{ paddingLeft: `${(depth + 1) * 12 + 10}px` }} className="py-1 text-xs text-gray-500 italic">Empty</div>
          )}
        </div>
      )}
    </div>
  );
};

const Sidebar: React.FC<SidebarProps> = ({ 
  files, 
  projectFiles,
  activeFileId, 
  rootDirName,
  rootDirHandle,
  isRecycleBinActive,
  onOpenFolder,
  onCloseFolder,
  onProjectFileSelect,
  onCreateFile,
  onCreateFolder,
  onDeleteFile,
  onRenameFile,
  onToggleRecycleBin,
  onRestoreFile
}) => {
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    targetHandle: FileSystemHandle | null;
    parentHandle: FileSystemDirectoryHandle | null;
    refreshCallback?: () => void;
  }>({ visible: false, x: 0, y: 0, targetHandle: null, parentHandle: null });

  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu({ ...contextMenu, visible: false });
      }
    };
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [contextMenu]);

  // Context Menu Handler
  const handleContextMenu = (
    e: React.MouseEvent, 
    handle: FileSystemHandle | null, 
    parentHandle: FileSystemDirectoryHandle | null,
    refresh?: () => void
  ) => {
    e.preventDefault();
    e.stopPropagation();
    
    let x = e.clientX;
    let y = e.clientY;
    if (window.innerWidth - x < 150) x = window.innerWidth - 150;
    
    setContextMenu({
      visible: true,
      x,
      y,
      targetHandle: handle,
      parentHandle: parentHandle,
      refreshCallback: refresh
    });
  };

  const handleAction = async (action: 'newFile' | 'newFolder' | 'delete' | 'open' | 'restore' | 'rename' | 'closeFolder') => {
    const { targetHandle, parentHandle, refreshCallback } = contextMenu;
    setContextMenu({ ...contextMenu, visible: false });
    
    if (action === 'newFile') {
       const dir = targetHandle?.kind === 'directory' ? (targetHandle as FileSystemDirectoryHandle) : parentHandle;
       if (dir) {
           await onCreateFile(dir);
           if (refreshCallback && targetHandle?.kind === 'directory') refreshCallback();
       }
    } else if (action === 'newFolder') {
       const dir = targetHandle?.kind === 'directory' ? (targetHandle as FileSystemDirectoryHandle) : parentHandle;
       if (dir) {
           await onCreateFolder(dir);
           if (refreshCallback && targetHandle?.kind === 'directory') refreshCallback();
       }
    } else if (action === 'delete') {
        if (targetHandle && parentHandle) {
             onDeleteFile(targetHandle.name, targetHandle.kind, parentHandle);
        }
    } else if (action === 'rename') {
        if (targetHandle && parentHandle) {
            onRenameFile(targetHandle.name, targetHandle.kind, parentHandle);
        }
    } else if (action === 'restore') {
        if (targetHandle && onRestoreFile) {
            onRestoreFile(targetHandle.name);
        }
    } else if (action === 'open') {
        if (targetHandle) onProjectFileSelect(targetHandle);
    } else if (action === 'closeFolder') {
        onCloseFolder();
    }
  };

  return (
    <div className="w-64 h-full bg-gray-50 dark:bg-[#252526] border-r border-gray-200 dark:border-[#3e3e42] flex flex-col relative select-none">
      {/* Header */}
      <div 
        className="h-10 px-4 flex items-center justify-between text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider shrink-0 bg-gray-100 dark:bg-[#252526] hover:bg-gray-200 dark:hover:bg-[#2a2d2e] cursor-default"
        onContextMenu={(e) => handleContextMenu(e, null, rootDirHandle || null)}
      >
        <span className={isRecycleBinActive ? "text-red-500 dark:text-red-400" : ""}>
            {isRecycleBinActive ? "Recycle Bin" : "Explorer"}
        </span>
        {!isRecycleBinActive && (
            <div className="flex gap-1">
                <button onClick={onOpenFolder} className="hover:text-black dark:hover:text-white p-1 rounded hover:bg-gray-300 dark:hover:bg-[#3e3e42]" title="Open Folder">
                    <Icons.FolderOpen size={14} />
                </button>
                <button onClick={() => onCreateFolder(rootDirHandle)} className="hover:text-black dark:hover:text-white p-1 rounded hover:bg-gray-300 dark:hover:bg-[#3e3e42]" title="New Folder">
                    <Icons.FolderPlus size={14} />
                </button>
                <button onClick={() => onCreateFile(rootDirHandle)} className="hover:text-black dark:hover:text-white p-1 rounded hover:bg-gray-300 dark:hover:bg-[#3e3e42]" title="New File">
                    <Icons.FileText size={14} />
                </button>
            </div>
        )}
      </div>
      
      {/* File List Area */}
      <div 
        className="flex-1 overflow-y-auto" 
        onContextMenu={(e) => handleContextMenu(e, null, rootDirHandle || null)}
      >
        <div className="pb-10"> 
             <div className="flex items-center justify-between text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider px-4 py-1 group bg-gray-50 dark:bg-[#252526] sticky top-0 z-10 border-b border-gray-200 dark:border-[#252526]">
                <span className="truncate">{rootDirName ? (isRecycleBinActive ? 'Deleted Files' : rootDirName) : 'No Folder'}</span>
            </div>
            
            {rootDirName && rootDirHandle ? (
                <div className="mt-1">
                     {projectFiles.map((handle, idx) => (
                        <FileTreeItem 
                            key={handle.name + idx}
                            handle={handle}
                            parentHandle={rootDirHandle}
                            depth={0}
                            path={handle.name} // Root level path is just the name
                            files={files}
                            activeFileId={activeFileId}
                            onProjectFileSelect={onProjectFileSelect}
                            onContextMenu={handleContextMenu}
                        />
                     ))}
                     {projectFiles.length === 0 && (
                        <div className="px-4 py-2 text-xs text-gray-500 italic">Empty</div>
                     )}
                </div>
            ) : (
                <div className="px-4 py-8 text-center">
                    <button 
                        onClick={onOpenFolder} 
                        className="bg-[#0e639c] text-white text-xs px-3 py-1.5 rounded hover:bg-[#1177bb] w-full"
                    >
                        Open Folder
                    </button>
                </div>
            )}
        </div>
      </div>

      {/* Recycle Bin Toggle */}
      {rootDirName && (
          <div 
            onClick={onToggleRecycleBin}
            className={`h-8 border-t border-gray-200 dark:border-[#3e3e42] flex items-center px-4 gap-2 text-xs cursor-pointer hover:bg-gray-200 dark:hover:bg-[#2a2d2e] transition-colors 
            ${isRecycleBinActive 
              ? 'bg-blue-100 dark:bg-[#37373d] text-blue-700 dark:text-white' 
              : 'text-gray-600 dark:text-gray-400'}`}
          >
              <Icons.Trash2 size={14} />
              <span>Recycle Bin</span>
          </div>
      )}

      {/* Context Menu Popup */}
      {contextMenu.visible && (
        <div 
          ref={menuRef}
          className="fixed bg-white dark:bg-[#252526] border border-gray-300 dark:border-[#454545] shadow-xl rounded py-1 z-[9999] w-48 text-sm flex flex-col"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()} 
        >
          {contextMenu.targetHandle ? (
            // === Item Context Menu ===
            <>
              <div className="px-3 py-1.5 text-gray-500 text-xs border-b border-gray-200 dark:border-[#3e3e42] mb-1 truncate font-medium">
                {contextMenu.targetHandle.name}
              </div>
              
              {!isRecycleBinActive && (
                  <>
                    {contextMenu.targetHandle.kind === 'file' ? (
                        <button className="text-left px-3 py-1.5 hover:bg-blue-600 hover:text-white text-gray-700 dark:text-[#cccccc] flex items-center gap-2" onClick={() => handleAction('open')}>
                            <Icons.FileText size={14} /> Open
                        </button>
                    ) : (
                        <>
                            <button className="text-left px-3 py-1.5 hover:bg-blue-600 hover:text-white text-gray-700 dark:text-[#cccccc] flex items-center gap-2" onClick={() => handleAction('newFile')}>
                                <Icons.FileText size={14} /> New File
                            </button>
                            <button className="text-left px-3 py-1.5 hover:bg-blue-600 hover:text-white text-gray-700 dark:text-[#cccccc] flex items-center gap-2" onClick={() => handleAction('newFolder')}>
                                <Icons.FolderPlus size={14} /> New Folder
                            </button>
                        </>
                    )}
                    
                    <button className="text-left px-3 py-1.5 hover:bg-blue-600 hover:text-white text-gray-700 dark:text-[#cccccc] flex items-center gap-2" onClick={() => handleAction('rename')}>
                        <Icons.Edit size={14} /> Rename
                    </button>
                    
                    <div className="border-t border-gray-200 dark:border-[#3e3e42] my-1"></div>
                  </>
              )}

              {isRecycleBinActive && onRestoreFile ? (
                  <button className="text-left px-3 py-1.5 hover:bg-blue-600 hover:text-white text-green-600 dark:text-green-400 flex items-center gap-2" onClick={() => handleAction('restore')}>
                    <Icons.CornerUpLeft size={14} /> Restore
                  </button>
              ) : (
                  <button className="text-left px-3 py-1.5 hover:bg-blue-600 hover:text-white text-red-600 dark:text-red-400 flex items-center gap-2" onClick={() => handleAction('delete')}>
                    <Icons.Trash2 size={14} /> {isRecycleBinActive ? 'Delete Forever' : 'Delete'}
                  </button>
              )}
            </>
          ) : (
            // === Background Context Menu ===
            !isRecycleBinActive && (
                <>
                    <button className="text-left px-3 py-1.5 hover:bg-blue-600 hover:text-white text-gray-700 dark:text-[#cccccc] flex items-center gap-2" onClick={() => { onCreateFile(rootDirHandle); setContextMenu({ ...contextMenu, visible: false }); }}>
                    <Icons.FileText size={14} /> New File
                    </button>
                    <button className="text-left px-3 py-1.5 hover:bg-blue-600 hover:text-white text-gray-700 dark:text-[#cccccc] flex items-center gap-2" onClick={() => { onCreateFolder(rootDirHandle); setContextMenu({ ...contextMenu, visible: false }); }}>
                    <Icons.FolderPlus size={14} /> New Folder
                    </button>
                    <div className="border-t border-gray-200 dark:border-[#3e3e42] my-1"></div>
                    <button className="text-left px-3 py-1.5 hover:bg-blue-600 hover:text-white text-gray-700 dark:text-[#cccccc] flex items-center gap-2" onClick={() => handleAction('closeFolder')}>
                    <Icons.LogOut size={14} /> Close Folder
                    </button>
                </>
            )
          )}
        </div>
      )}
    </div>
  );
};

export default Sidebar;
