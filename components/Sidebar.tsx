import React from 'react';
import { Icons } from './Icon';
import { EditorFile, FileSystemHandle } from '../types';

interface SidebarProps {
  files: EditorFile[];
  projectFiles: FileSystemHandle[];
  activeFileId: string | null;
  rootDirName?: string;
  onFileSelect: (id: string) => void;
  onFileClose: (id: string, e: React.MouseEvent) => void;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onProjectFileSelect: (handle: any) => void;
  onCreateFile: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ 
  files, 
  projectFiles,
  activeFileId, 
  rootDirName,
  onFileSelect, 
  onFileClose,
  onOpenFile,
  onOpenFolder,
  onProjectFileSelect,
  onCreateFile
}) => {

  const handleDoubleClick = (e: React.MouseEvent) => {
    // Only create file if clicking empty space
    if ((e.target as HTMLElement).closest('.file-item-group')) {
        return;
    }
    onCreateFile();
  };

  return (
    <div className="w-64 h-full bg-[#252526] border-r border-[#3e3e42] flex flex-col">
      <div className="h-10 px-4 flex items-center justify-between text-xs font-bold text-gray-400 uppercase tracking-wider shrink-0 select-none">
        <span>Explorer</span>
        <div className="flex gap-1">
             <button onClick={onOpenFolder} className="hover:text-white" title="Open Folder">
                <Icons.FolderOpen size={16} />
            </button>
            <button onClick={onOpenFile} className="hover:text-white" title="Open File">
                <Icons.File size={16} />
            </button>
        </div>
      </div>
      
      <div 
        className="flex-1 overflow-y-auto" 
        onDoubleClick={handleDoubleClick}
      >
        {/* Section 1: Open Editors */}
        <div className="px-0 py-1">
            <div className="flex items-center text-xs font-bold text-gray-400 uppercase tracking-wider px-4 py-1 select-none">
                Open Editors
            </div>
            <div>
            {files.map(file => (
                <div 
                key={file.id}
                onClick={() => onFileSelect(file.id)}
                className={`
                    file-item-group group flex items-center justify-between px-4 py-1 text-sm cursor-pointer select-none
                    ${file.id === activeFileId ? 'bg-[#37373d] text-white' : 'text-[#cccccc] hover:bg-[#2a2d2e]'}
                `}
                >
                <div className="flex items-center gap-2 overflow-hidden">
                    <Icons.FileText size={14} className={file.id === activeFileId ? 'text-blue-400' : 'text-gray-500'} />
                    <span className="truncate">{file.name}</span>
                    {file.isDirty && (
                    <div className="w-2 h-2 rounded-full bg-white ml-1 opacity-80" />
                    )}
                </div>
                <button 
                    onClick={(e) => onFileClose(file.id, e)}
                    className={`opacity-0 group-hover:opacity-100 hover:bg-[#454545] rounded p-0.5 ${file.isDirty ? 'hidden group-hover:block' : ''}`}
                >
                    <Icons.X size={12} />
                </button>
                </div>
            ))}
            {files.length === 0 && (
                <div className="px-4 py-2 text-xs text-gray-500 italic">No files open</div>
            )}
            </div>
        </div>

        {/* Section 2: Folder View */}
        <div className="mt-4">
             <div className="flex items-center justify-between text-xs font-bold text-gray-400 uppercase tracking-wider px-4 py-1 select-none group">
                <span>{rootDirName || 'No Folder Opened'}</span>
            </div>
            
            {rootDirName ? (
                <div>
                     {projectFiles.map((handle, idx) => (
                        <div 
                            key={handle.name + idx}
                            onClick={() => onProjectFileSelect(handle)}
                            className="file-item-group flex items-center gap-2 px-4 py-1 text-sm text-[#cccccc] hover:bg-[#2a2d2e] cursor-pointer select-none"
                        >
                            <Icons.File size={14} className="text-gray-500" />
                            <span className="truncate">{handle.name}</span>
                        </div>
                     ))}
                     {projectFiles.length === 0 && (
                        <div className="px-4 py-2 text-xs text-gray-500 italic">Empty folder</div>
                     )}
                </div>
            ) : (
                <div className="px-4 py-2 text-center">
                    <button 
                        onClick={onOpenFolder} 
                        className="bg-[#0e639c] text-white text-xs px-3 py-1.5 rounded hover:bg-[#1177bb] w-full"
                    >
                        Open Folder
                    </button>
                    <p className="mt-4 text-xs text-gray-500">Double-click blank space to create new file</p>
                </div>
            )}
        </div>

      </div>
    </div>
  );
};

export default Sidebar;
