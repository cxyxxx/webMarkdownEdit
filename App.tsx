

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import Sidebar from './components/Sidebar';
import EditorPane from './components/EditorPane';
import MarkdownPreview from './components/MarkdownPreview';
import WysiwygEditor from './components/WysiwygEditor';
import { Icons } from './components/Icon';
import { fileSystem, RecentFolder } from './services/fileSystem';
import { EditorFile, AppState, FileSystemDirectoryHandle, FileSystemHandle, FileSystemFileHandle } from './types';
import { AUTO_SAVE_DELAY_MS, LOCAL_STORAGE_SESSION_KEY, DEFAULT_CONTENT } from './constants';

const isImageFile = (name: string) => /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(name);

// Sanitize filename helper
const sanitizeFileName = (name: string) => {
    return name.replace(/[\\/:*?"<>|]/g, '').trim();
};

const Toast: React.FC<{ message: string; visible: boolean }> = ({ message, visible }) => {
  if (!visible) return null;
  return (
    <div className="absolute top-16 right-4 bg-blue-600 text-white px-4 py-2 rounded shadow-lg flex items-center gap-2 z-50 transition-opacity duration-300 animate-in fade-in slide-in-from-top-2">
      <Icons.FileText size={16} />
      <span className="text-sm font-medium">{message}</span>
    </div>
  );
};

const Modal: React.FC<{ 
  title: string; 
  children: React.ReactNode; 
  onClose: () => void; 
  onConfirm?: () => void; 
  confirmText?: string; 
  confirmColor?: string;
}> = ({ title, children, onClose, onConfirm, confirmText = "Confirm", confirmColor = "bg-blue-600 hover:bg-blue-700" }) => (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100] p-4 animate-in fade-in">
        <div className="bg-white dark:bg-[#252526] border border-gray-200 dark:border-[#454545] rounded-lg shadow-2xl w-full max-w-sm flex flex-col text-gray-900 dark:text-[#cccccc]">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-[#3e3e42]">
            <h3 className="text-lg font-bold">{title}</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-black dark:hover:text-white transition-colors">
                <Icons.X size={20} />
            </button>
        </div>
        <div className="p-6">{children}</div>
        <div className="flex justify-end gap-3 p-4 bg-gray-50 dark:bg-[#1e1e1e] rounded-b-lg border-t border-gray-200 dark:border-[#3e3e42]">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-black dark:hover:text-white hover:bg-gray-200 dark:hover:bg-[#3e3e42] rounded transition-colors">Cancel</button>
            {onConfirm && <button onClick={onConfirm} className={`px-4 py-2 text-sm text-white rounded shadow-lg ${confirmColor} transition-colors font-medium`}>{confirmText}</button>}
        </div>
        </div>
    </div>
);

const ImageViewer: React.FC<{ file: EditorFile }> = ({ file }) => {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    const load = async () => {
      if (file.handle) {
        try {
          const f = await file.handle.getFile();
          url = URL.createObjectURL(f);
          setSrc(url);
        } catch (e) { console.error("Failed to load image", e); }
      }
    };
    load();
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [file]);
  if (!src) return <div className="flex items-center justify-center h-full text-gray-500">Loading image...</div>;
  return (<div className="flex items-center justify-center h-full bg-gray-100 dark:bg-[#1e1e1e] overflow-auto p-8"><img src={src} alt={file.name} className="max-w-full max-h-full shadow-lg rounded" /></div>);
};

// Welcome / Start Screen Component
const WelcomeScreen: React.FC<{ 
  recentFolders: RecentFolder[]; 
  onOpenFolder: () => void; 
  onOpenRecent: (handle: FileSystemDirectoryHandle) => void; 
}> = ({ recentFolders, onOpenFolder, onOpenRecent }) => {
    
    // Split recents into most recent (Hero) and others
    const lastOpened = recentFolders.length > 0 ? recentFolders[0] : null;
    const otherRecents = recentFolders.length > 1 ? recentFolders.slice(1) : [];

    return (
        <div className="absolute inset-0 z-50 bg-gray-50 dark:bg-[#1e1e1e] flex flex-col items-center justify-center text-gray-900 dark:text-[#cccccc] p-8 overflow-y-auto transition-colors duration-300">
            <div className="w-full max-w-4xl animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex items-center justify-center gap-3 mb-12">
                     <div className="bg-blue-600 p-3 rounded-xl shadow-lg shadow-blue-900/20">
                        <Icons.FileText size={40} className="text-white" />
                     </div>
                     <h1 className="text-4xl font-bold text-gray-900 dark:text-white tracking-tight">MarkDown <span className="text-blue-500">Pro</span></h1>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Left Column: Actions & Last Opened */}
                    <div className="space-y-6">
                        <h2 className="text-xl font-semibold text-gray-800 dark:text-white flex items-center gap-2">
                            <Icons.ArrowRight className="text-blue-500" /> Start
                        </h2>
                        
                        <button 
                            onClick={onOpenFolder}
                            className="w-full flex items-center justify-between p-6 bg-white dark:bg-[#2d2d2d] hover:bg-gray-100 dark:hover:bg-[#333333] border border-gray-200 dark:border-[#3e3e42] hover:border-blue-500 rounded-xl transition-all shadow-lg group"
                        >
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-blue-100 dark:bg-blue-500/10 rounded-lg group-hover:bg-blue-200 dark:group-hover:bg-blue-500/20 transition-colors">
                                    <Icons.FolderOpen size={28} className="text-blue-600 dark:text-blue-400" />
                                </div>
                                <div className="text-left">
                                    <div className="font-semibold text-gray-900 dark:text-white text-lg">Open Folder</div>
                                    <div className="text-sm text-gray-500">Browse your local file system</div>
                                </div>
                            </div>
                            <Icons.ArrowRight size={20} className="text-gray-400 dark:text-gray-500 group-hover:text-blue-600 dark:group-hover:text-white transition-colors" />
                        </button>

                        {/* Hero Card for Last Opened */}
                        {lastOpened && (
                             <div className="mt-8">
                                <h2 className="text-xl font-semibold text-gray-800 dark:text-white flex items-center gap-2 mb-4">
                                    <Icons.History className="text-yellow-600 dark:text-yellow-500" /> Recent
                                </h2>
                                <div 
                                    onClick={() => onOpenRecent(lastOpened.handle)}
                                    className="cursor-pointer group relative overflow-hidden bg-gradient-to-br from-white to-gray-50 dark:from-[#252526] dark:to-[#1e1e1e] p-6 rounded-xl border border-gray-200 dark:border-[#3e3e42] hover:border-yellow-500/50 transition-all shadow-xl"
                                >
                                    <div className="absolute top-0 right-0 bg-yellow-100 dark:bg-yellow-500/10 text-yellow-700 dark:text-yellow-500 text-xs font-bold px-3 py-1 rounded-bl-xl border-l border-b border-yellow-200 dark:border-yellow-500/20">
                                        LAST OPENED
                                    </div>
                                    <div className="flex items-center gap-4 mb-2">
                                        <div className="p-3 bg-yellow-100 dark:bg-yellow-500/10 rounded-full">
                                            <Icons.FolderOpen size={24} className="text-yellow-600 dark:text-yellow-500" />
                                        </div>
                                        <div>
                                            <h3 className="text-xl font-bold text-gray-900 dark:text-white group-hover:text-yellow-600 dark:group-hover:text-yellow-400 transition-colors">{lastOpened.name}</h3>
                                            <p className="text-xs text-gray-500 flex items-center gap-1 mt-1">
                                                <Icons.Clock size={10} /> {new Date(lastOpened.lastAccessed).toLocaleString()}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                             </div>
                        )}
                    </div>

                    {/* Right Column: Other History */}
                    <div className="flex flex-col h-full max-h-[400px]">
                        <h2 className="text-xl font-semibold text-gray-800 dark:text-white flex items-center gap-2 mb-4">
                            <Icons.Clock className="text-gray-500" /> History
                        </h2>
                        <div className="flex-1 bg-white dark:bg-[#252526] rounded-xl border border-gray-200 dark:border-[#3e3e42] overflow-hidden flex flex-col shadow-sm">
                            <div className="overflow-y-auto p-2 space-y-1 custom-scrollbar flex-1">
                                {otherRecents.length === 0 && (
                                    <div className="h-full flex flex-col items-center justify-center text-gray-400 dark:text-gray-600 italic p-8">
                                        <Icons.History size={32} className="mb-2 opacity-50" />
                                        No other recent projects
                                    </div>
                                )}
                                {otherRecents.map((item) => (
                                    <button
                                        key={item.name}
                                        onClick={() => onOpenRecent(item.handle)}
                                        className="w-full text-left p-3 hover:bg-gray-100 dark:hover:bg-[#333333] rounded-lg transition-colors flex items-center gap-3 group border border-transparent hover:border-gray-200 dark:hover:border-[#3e3e42]"
                                    >
                                        <Icons.FolderOpen size={18} className="text-gray-400 dark:text-gray-500 group-hover:text-blue-500 dark:group-hover:text-blue-400" />
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white truncate">{item.name}</div>
                                            <div className="text-xs text-gray-500 truncate">{new Date(item.lastAccessed).toLocaleDateString()}</div>
                                        </div>
                                        <Icons.ArrowRight size={14} className="opacity-0 group-hover:opacity-100 text-gray-400 dark:text-gray-500" />
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const TRASH_DIR_NAME = '.trash';

const App: React.FC = () => {
  const [files, setFiles] = useState<EditorFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [viewMode, setViewMode] = useState<'editor' | 'split' | 'preview' | 'wysiwyg'>('split');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [autoSaveTimer, setAutoSaveTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [toast, setToast] = useState<{ message: string; visible: boolean }>({ message: '', visible: false });
  const [tabContextMenu, setTabContextMenu] = useState<{ visible: boolean; x: number; y: number; fileId: string | null; }>({ visible: false, x: 0, y: 0, fileId: null });
  const [pendingScrollAnchor, setPendingScrollAnchor] = useState<string | null>(null);
  
  // File System State
  const [rootDirHandle, setRootDirHandle] = useState<FileSystemDirectoryHandle | undefined>(undefined);
  const [projectFiles, setProjectFiles] = useState<FileSystemHandle[]>([]);
  const [recentFolders, setRecentFolders] = useState<RecentFolder[]>([]);
  const [isLoadingRecents, setIsLoadingRecents] = useState(true);
  const [isRestoring, setIsRestoring] = useState(false); // Flag to prevent auto-save overwrites during load

  const [deleteTarget, setDeleteTarget] = useState<{ name: string; kind: 'file' | 'directory'; parentHandle: FileSystemDirectoryHandle } | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ name: string; kind: 'file' | 'directory'; parentHandle: FileSystemDirectoryHandle } | null>(null);
  const [renameName, setRenameName] = useState("");
  
  const [isRecycleBinActive, setIsRecycleBinActive] = useState(false);

  // Rename debounce
  const autoRenameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeFile = files.find(f => f.id === activeFileId);

  // Initialize: Load Recents & Theme
  useEffect(() => {
    const init = async () => {
        const recents = await fileSystem.getRecents();
        setRecentFolders(recents);
        setIsLoadingRecents(false);
        
        const savedSession = localStorage.getItem(LOCAL_STORAGE_SESSION_KEY);
        if (savedSession) {
             try {
                 const parsed = JSON.parse(savedSession);
                 setSidebarVisible(parsed.sidebarVisible ?? true);
                 // Migrate legacy previewVisible to viewMode
                 if (parsed.viewMode) {
                     setViewMode(parsed.viewMode);
                 } else if (parsed.previewVisible === false) {
                     setViewMode('editor');
                 } else {
                     setViewMode('split');
                 }
                 if (parsed.theme) {
                    setTheme(parsed.theme);
                 }
             } catch(e) {}
        }
    };
    init();
  }, []);

  // Safety Net: If files exist but no active file, select the first one.
  useEffect(() => {
      if (files.length > 0 && !activeFileId) {
          setActiveFileId(files[0].id);
      }
  }, [files, activeFileId]);

  // Sync Theme with DOM
  useEffect(() => {
      if (theme === 'dark') {
          document.documentElement.classList.add('dark');
      } else {
          document.documentElement.classList.remove('dark');
      }
  }, [theme]);

  const toggleTheme = () => {
      setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  // Save Workspace State (Files, Positions)
  const saveWorkspaceState = useCallback(() => {
      if (!rootDirHandle || isRestoring) return;

      const workspaceKey = `mdpro_workspace_${rootDirHandle.name}`;
      
      const openFilesState = files.map(f => ({
          name: f.name,
          path: f.path,
          cursorPosition: f.cursorPosition,
      })).filter(f => f.path);

      const activeFilePath = files.find(f => f.id === activeFileId)?.path;

      const workspaceState = {
          openFiles: openFilesState,
          activeFilePath
      };

      localStorage.setItem(workspaceKey, JSON.stringify(workspaceState));

      // Also save global session settings
      const globalState: Partial<AppState> = { sidebarVisible, viewMode, theme };
      localStorage.setItem(LOCAL_STORAGE_SESSION_KEY, JSON.stringify(globalState));
  }, [files, activeFileId, rootDirHandle, sidebarVisible, viewMode, theme, isRestoring]);

  // Auto-save workspace state
  useEffect(() => {
      const timer = setTimeout(saveWorkspaceState, 2000);
      return () => clearTimeout(timer);
  }, [saveWorkspaceState]);

  useEffect(() => {
    window.addEventListener('beforeunload', saveWorkspaceState);
    return () => { window.removeEventListener('beforeunload', saveWorkspaceState); };
  }, [saveWorkspaceState]);

  useEffect(() => { if (rootDirHandle) refreshProjectFiles(); }, [rootDirHandle, isRecycleBinActive]);

  useEffect(() => {
    const handleClick = () => setTabContextMenu(prev => ({ ...prev, visible: false }));
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  const refreshProjectFiles = async () => {
      if (!rootDirHandle) return;
      try {
          if (isRecycleBinActive) {
              try {
                  const trashHandle = await rootDirHandle.getDirectoryHandle(TRASH_DIR_NAME);
                  const items = await fileSystem.listFiles(trashHandle);
                  setProjectFiles(items);
              } catch (e) {
                  setProjectFiles([]);
              }
          } else {
              const items = await fileSystem.listFiles(rootDirHandle);
              const filtered = items.filter(i => !i.name.startsWith('.'));
              setProjectFiles(filtered);
          }
      } catch (e) { console.error("Error reading directory", e); }
  };

  const showToast = (message: string) => {
    setToast({ message, visible: true });
    setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 2000);
  };

  const handleTabContextMenu = (e: React.MouseEvent, fileId: string) => {
    e.preventDefault(); e.stopPropagation();
    setTabContextMenu({ visible: true, x: e.clientX, y: e.clientY, fileId });
  };

  const handleTabAction = (action: 'close' | 'closeOthers' | 'closeAll') => {
    const targetId = tabContextMenu.fileId;
    if (!targetId && action !== 'closeAll') return;
    if (action === 'close' && targetId) handleCloseFile(targetId);
    else if (action === 'closeOthers' && targetId) {
      const fileToKeep = files.find(f => f.id === targetId);
      if (fileToKeep) { setFiles([fileToKeep]); setActiveFileId(fileToKeep.id); }
    } else if (action === 'closeAll') { setFiles([]); setActiveFileId(null); }
    setTabContextMenu(prev => ({ ...prev, visible: false }));
  };

  const handleOpenFolder = async () => {
      try {
          const dirHandle = await fileSystem.openDirectory();
          await loadProject(dirHandle);
      } catch (e) { /* Ignore */ }
  };

  const handleCloseFolder = async () => {
      setRootDirHandle(undefined);
      setFiles([]);
      setActiveFileId(null);
      setIsRecycleBinActive(false);
      const recents = await fileSystem.getRecents();
      setRecentFolders(recents);
  };

  const handleOpenRecent = async (handle: FileSystemDirectoryHandle) => {
      // @ts-ignore
      const opts = { mode: 'readwrite' };
      // @ts-ignore
      if ((await handle.queryPermission(opts)) === 'granted') {
          await loadProject(handle);
          return;
      }
      // @ts-ignore
      if ((await handle.requestPermission(opts)) === 'granted') {
          await loadProject(handle);
          return;
      }
      showToast("Permission denied");
  };

  const getFileHandleFromPath = async (rootDir: FileSystemDirectoryHandle, path: string): Promise<FileSystemFileHandle | null> => {
      try {
        const parts = path.split('/');
        const fileName = parts.pop();
        if (!fileName) return null;
        
        let currentDir = rootDir;
        for (const part of parts) {
            currentDir = await currentDir.getDirectoryHandle(part);
        }
        return await currentDir.getFileHandle(fileName);
      } catch (e) {
          console.warn("Could not resolve handle from path", path);
          return null;
      }
  };

  const restoreWorkspace = async (dirHandle: FileSystemDirectoryHandle) => {
      const workspaceKey = `mdpro_workspace_${dirHandle.name}`;
      const savedState = localStorage.getItem(workspaceKey);
      
      let restoredCount = 0;

      if (savedState) {
          try {
              const { openFiles, activeFilePath } = JSON.parse(savedState);
              
              if (Array.isArray(openFiles)) {
                  const restoredFiles: EditorFile[] = [];
                  for (const savedFile of openFiles) {
                      if (savedFile.path) {
                          const handle = await getFileHandleFromPath(dirHandle, savedFile.path);
                          if (handle) {
                              let content = '';
                              // Only read text content for non-images
                              if (!isImageFile(handle.name)) {
                                  content = await fileSystem.readFile(handle);
                              }
                              
                              restoredFiles.push({
                                  id: uuidv4(),
                                  name: savedFile.name,
                                  path: savedFile.path,
                                  handle: handle,
                                  content: content,
                                  isDirty: false,
                                  lastModified: Date.now(),
                                  cursorPosition: savedFile.cursorPosition
                              });
                          }
                      }
                  }

                  if (restoredFiles.length > 0) {
                      setFiles(restoredFiles);
                      restoredCount = restoredFiles.length;
                      
                      if (activeFilePath) {
                          const active = restoredFiles.find(f => f.path === activeFilePath);
                          if (active) setActiveFileId(active.id);
                          else setActiveFileId(restoredFiles[0].id); // Default to first if active not found
                      } else {
                          setActiveFileId(restoredFiles[0].id); // Default to first
                      }
                  }
              }
          } catch (e) {
              console.error("Failed to restore workspace", e);
          }
      }

      // Fallback: If no files restored (new project or empty), try auto-opening README.md
      if (restoredCount === 0) {
          try {
              const items = await fileSystem.listFiles(dirHandle);
              const readme = items.find(i => i.name.toLowerCase() === 'readme.md' && i.kind === 'file');
              const firstMd = items.find(i => i.name.toLowerCase().endsWith('.md') && i.kind === 'file');
              const target = readme || firstMd;
              
              if (target && target.kind === 'file') {
                  const content = await fileSystem.readFile(target as FileSystemFileHandle);
                  const newFile: EditorFile = { 
                    id: uuidv4(), 
                    name: target.name, 
                    path: target.name,
                    handle: target as FileSystemFileHandle, 
                    content, 
                    isDirty: false, 
                    lastModified: Date.now() 
                };
                setFiles([newFile]);
                setActiveFileId(newFile.id);
              }
          } catch (e) {
              console.warn("Auto-open fallback failed", e);
          }
      }
  };

  const loadProject = async (dirHandle: FileSystemDirectoryHandle) => {
      setIsRestoring(true);
      try {
        setRootDirHandle(dirHandle);
        setIsRecycleBinActive(false);
        setFiles([]); 
        setActiveFileId(null);
        
        await fileSystem.addToRecents(dirHandle);
        const updatedRecents = await fileSystem.getRecents();
        setRecentFolders(updatedRecents);

        // Attempt to restore previous files
        await restoreWorkspace(dirHandle);
      } finally {
        setIsRestoring(false);
      }
  };

  const handleProjectFileSelect = async (handle: FileSystemFileHandle) => {
      for (const file of files) {
          if (file.handle) {
              const same = await file.handle.isSameEntry(handle);
              if (same) {
                  setActiveFileId(file.id);
                  return;
              }
          }
      }

      let relativePath: string | undefined;
      if (rootDirHandle) {
          const pathArr = await rootDirHandle.resolve(handle);
          if (pathArr) relativePath = pathArr.join('/');
      }

      if (relativePath) {
          const existingByPath = files.find(f => !f.handle && f.path === relativePath);
          if (existingByPath) {
              setFiles(prev => prev.map(f => f.id === existingByPath.id ? { ...f, handle, isDirty: false } : f));
              setActiveFileId(existingByPath.id);
              return;
          }
      }

      if (isImageFile(handle.name)) {
        const newFile: EditorFile = { 
            id: uuidv4(), 
            name: handle.name, 
            path: relativePath,
            handle, 
            content: '', 
            isDirty: false, 
            lastModified: Date.now() 
        };
        setFiles(prev => [...prev, newFile]); 
        setActiveFileId(newFile.id);
        return;
      }

      try {
        const content = await fileSystem.readFile(handle);
        const newFile: EditorFile = { 
            id: uuidv4(), 
            name: handle.name, 
            path: relativePath,
            handle, 
            content, 
            isDirty: false, 
            lastModified: Date.now() 
        };
        setFiles(prev => [...prev, newFile]); 
        setActiveFileId(newFile.id);
      } catch (e) { console.error("Failed to open project file", e); }
  };

  const handleCreateFile = async (parentHandle?: FileSystemDirectoryHandle) => {
    const targetDir = parentHandle || rootDirHandle;
    
    if (targetDir && !isRecycleBinActive) {
        try {
            const name = `Untitled-${Date.now().toString().slice(-4)}.md`;
            const handle = await fileSystem.createFileInDir(targetDir, name, '');
            if (targetDir === rootDirHandle) await refreshProjectFiles();
            
            let relativePath: string | undefined;
            if (rootDirHandle) {
                const pathArr = await rootDirHandle.resolve(handle);
                if (pathArr) relativePath = pathArr.join('/');
            }

            const newFile: EditorFile = { 
                id: uuidv4(), 
                name, 
                path: relativePath,
                handle, 
                content: '', 
                isDirty: false, 
                lastModified: Date.now() 
            };
            setFiles(prev => [...prev, newFile]); 
            setActiveFileId(newFile.id);
        } catch (e) { console.error("Create failed", e); }
    } else if (!targetDir) {
        const newFile: EditorFile = { id: uuidv4(), name: `Untitled-${files.length + 1}.md`, content: '', isDirty: true, lastModified: Date.now() };
        setFiles(prev => [...prev, newFile]); setActiveFileId(newFile.id);
    }
  };

  const handleCreateFolder = async (parentHandle?: FileSystemDirectoryHandle) => {
      const targetDir = parentHandle || rootDirHandle;
      if (!targetDir || isRecycleBinActive) return;
      
      const name = prompt("Enter folder name:");
      if (!name) return;
      try {
          await fileSystem.createDirectory(targetDir, name);
          if (targetDir === rootDirHandle) await refreshProjectFiles();
      } catch (e) { console.error("Create folder failed", e); showToast('Failed to create folder'); }
  };

  const handleCloseFile = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const fileToClose = files.find(f => f.id === id);
    if (fileToClose?.handle && fileToClose.isDirty) { /* prompt logic could go here */ }
    const newFiles = files.filter(f => f.id !== id);
    setFiles(newFiles);
    if (activeFileId === id) setActiveFileId(newFiles.length > 0 ? newFiles[newFiles.length - 1].id : null);
  };

  const handleSave = async () => {
    const current = files.find(f => f.id === activeFileId);
    if (!current || isImageFile(current.name)) return;

    try {
      let fileHandle = current.handle;

      if (!fileHandle && current.path && rootDirHandle) {
          const recoveredHandle = await getFileHandleFromPath(rootDirHandle, current.path);
          if (recoveredHandle) {
              fileHandle = recoveredHandle;
              setFiles(prev => prev.map(f => f.id === current.id ? { ...f, handle: recoveredHandle } : f));
          }
      }

      if (fileHandle) {
        await fileSystem.saveFile(fileHandle, current.content);
        setFiles(prev => prev.map(f => f.id === current.id ? { ...f, isDirty: false } : f));
        showToast('Saved to disk');
      } else if (rootDirHandle && !current.path) {
        const handle = await fileSystem.createFileInDir(rootDirHandle, current.name, current.content);
        const pathArr = await rootDirHandle.resolve(handle);
        const path = pathArr ? pathArr.join('/') : current.name;
        
        setFiles(prev => prev.map(f => f.id === current.id ? { ...f, handle, path, isDirty: false } : f));
        await refreshProjectFiles();
        showToast('Saved to folder');
      } else {
        setFiles(prev => prev.map(f => f.id === current.id ? { ...f, isDirty: false } : f));
        showToast('Saved (Browser Storage)');
      }
    } catch (err) { console.error("Save failed", err); showToast('Save failed'); }
  };

  const handlePasteImage = async (blob: Blob): Promise<string | null> => {
      if (!rootDirHandle) { 
        showToast("Pasted as Data URL (No folder open)"); 
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                resolve(reader.result as string);
            };
            reader.readAsDataURL(blob);
        });
      }

      try {
          const ASSETS_DIR = 'assets'; 
          let assetsHandle: FileSystemDirectoryHandle;
          try {
              assetsHandle = await rootDirHandle.getDirectoryHandle(ASSETS_DIR);
          } catch {
              assetsHandle = await rootDirHandle.getDirectoryHandle(ASSETS_DIR, { create: true });
          }

          const now = new Date();
          const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
          const fileName = `image-${timestamp}.png`;
          
          await fileSystem.createFileInDir(assetsHandle, fileName, blob);
          await refreshProjectFiles();
          
          const fullPath = `${ASSETS_DIR}/${fileName}`;
          
          const activeFile = files.find(f => f.id === activeFileId);
          if (activeFile && activeFile.path) {
              const depth = activeFile.path.split('/').length - 1;
              if (depth > 0) {
                  const prefix = '../'.repeat(depth);
                  return `${prefix}${fullPath}`;
              }
          }
          
          return fullPath;
      } catch (e) { console.error("Failed to save pasted image", e); return null; }
  };

  const handleLinkClick = (linkTarget: string) => {
    const parts = linkTarget.split('#');
    const targetPath = parts[0];
    const anchor = parts.length > 1 ? parts[1] : null;
    setPendingScrollAnchor(anchor);
    if (activeFile && (activeFile.name === targetPath || activeFile.name === `${targetPath}.md`)) return;
    let candidates = [targetPath];
    if (!targetPath.match(/\.[a-zA-Z0-9]+$/)) candidates.push(`${targetPath}.md`);
    for (const name of candidates) { const openFile = files.find(f => f.name === name); if (openFile) { setActiveFileId(openFile.id); return; } }
    for (const name of candidates) { const handle = projectFiles.find(f => f.name === name); if (handle && handle.kind === 'file') { handleProjectFileSelect(handle as FileSystemFileHandle); return; } }
    const newName = candidates.length > 1 ? candidates[1] : candidates[0];
    const newFile: EditorFile = { id: uuidv4(), name: newName, content: `# ${targetPath}\n\n`, isDirty: true, lastModified: Date.now() };
    setFiles(prev => [...prev, newFile]); setActiveFileId(newFile.id);
  };

  // Generalized Rename Function (used by UI and Auto-Sync)
  const executeRename = async (fileId: string, newName: string) => {
      if (!rootDirHandle) return;
      const file = files.find(f => f.id === fileId);
      if (!file || file.name === newName) return;

      try {
          let parentHandle = rootDirHandle;
          let parentPath = '';

          // Determine parent handle from file path
          if (file.path) {
              const parts = file.path.split('/');
              parts.pop(); // remove filename
              for (const part of parts) {
                  parentHandle = await parentHandle.getDirectoryHandle(part);
              }
              parentPath = parts.join('/');
          }

          // Execute rename in FS
          await fileSystem.renameEntry(parentHandle, file.name, newName, 'file');

          // Try to get new handle
          let newHandle: FileSystemFileHandle | undefined = undefined;
          try {
             newHandle = await parentHandle.getFileHandle(newName);
          } catch (e) {}

          const newPath = parentPath ? `${parentPath}/${newName}` : newName;

          setFiles(prev => prev.map(f => {
              if (f.id === fileId) {
                  return { ...f, name: newName, path: newPath, handle: newHandle || f.handle };
              }
              return f;
          }));

          if (parentHandle === rootDirHandle) {
              await refreshProjectFiles();
          }

      } catch (e) {
          console.error("Execute rename failed", e);
      }
  };

  const handleContentChange = useCallback((newContent: string) => {
    if (!activeFileId) return;
    
    // Auto Update Filename from H1
    const lines = newContent.split('\n');
    const firstLine = lines.find(l => l.trim().startsWith('# '));
    if (firstLine) {
        const rawTitle = firstLine.replace('# ', '').trim();
        const safeTitle = sanitizeFileName(rawTitle);
        if (safeTitle) {
            const currentFile = files.find(f => f.id === activeFileId);
            if (currentFile && currentFile.name) {
                // Preserve original extension
                const parts = currentFile.name.split('.');
                const ext = parts.length > 1 ? parts.pop() : 'md';
                const newName = `${safeTitle}.${ext}`;

                if (currentFile.name !== newName) {
                    if (autoRenameTimerRef.current) clearTimeout(autoRenameTimerRef.current);
                    autoRenameTimerRef.current = setTimeout(() => {
                        executeRename(activeFileId, newName);
                    }, 2000); // 2 second debounce for rename
                }
            }
        }
    }

    setFiles(prev => prev.map(f => f.id === activeFileId ? { ...f, content: newContent, isDirty: true } : f));
    
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    const currentFileId = activeFileId;
    const timer = setTimeout(async () => {
        setFiles(currentFiles => {
            const f = currentFiles.find(file => file.id === currentFileId);
            if (f && f.handle) {
                fileSystem.saveFile(f.handle, newContent).then(() => {
                    setFiles(updated => updated.map(u => u.id === currentFileId ? {...u, isDirty: false} : u));
                }).catch(e => console.warn('Auto-save failed', e));
            } else if (f && !f.handle) {
                return currentFiles;
            }
            return currentFiles;
        });
    }, AUTO_SAVE_DELAY_MS);
    setAutoSaveTimer(timer);
  }, [activeFileId, files, rootDirHandle]); // Added dependencies for sync logic

  const handleCursorChange = useCallback((lineNumber: number, column: number) => {
      if (!activeFileId) return;
      setFiles(prev => prev.map(f => f.id === activeFileId ? { ...f, cursorPosition: { lineNumber, column } } : f));
  }, [activeFileId]);

  const handleDeleteRequest = async (name: string, kind: 'file' | 'directory', parentHandle: FileSystemDirectoryHandle) => { 
      setDeleteTarget({ name, kind, parentHandle }); 
  };

  const confirmDelete = async () => {
      if (!deleteTarget || !rootDirHandle) return;
      const { name, kind, parentHandle } = deleteTarget;

      try {
          if (isRecycleBinActive) {
              await parentHandle.removeEntry(name, { recursive: true });
              showToast('Deleted forever');
          } else {
              const trashHandle = await rootDirHandle.getDirectoryHandle(TRASH_DIR_NAME, { create: true });
              await fileSystem.moveEntry(parentHandle, name, trashHandle, kind);
              showToast('Moved to Recycle Bin');
          }
          if (parentHandle === rootDirHandle || isRecycleBinActive) await refreshProjectFiles();
      } catch (e) { console.error("Delete failed", e); showToast('Delete failed'); }

      const fileOpen = files.find(f => f.name === name);
      if (fileOpen) handleCloseFile(fileOpen.id);
      
      setDeleteTarget(null);
  };

  const handleRenameRequest = (name: string, kind: 'file' | 'directory', parentHandle: FileSystemDirectoryHandle) => {
    setRenameTarget({ name, kind, parentHandle });
    setRenameName(name);
  };

  const confirmRename = async () => {
    if (!renameTarget) return;
    const { name: oldName, kind, parentHandle } = renameTarget;
    
    if (!renameName || renameName === oldName) {
        setRenameTarget(null);
        return;
    }

    // Use shared executeRename for files if it's the active one, or manual for others/folders
    try {
        if (kind === 'file') {
             // Check if this is an open file to update state correctly
             // For open files, we have ID, so we might want to use executeRename if it matches active.
             // But Sidebar rename might target non-active files.
             
             // ... manual rename logic matching previous implementation for generic case ...
             await fileSystem.renameEntry(parentHandle, oldName, renameName, kind);
             
             let newHandle: FileSystemFileHandle | undefined = undefined;
             try { newHandle = await parentHandle.getFileHandle(renameName); } catch (e) {}

             let newPath: string | undefined;
             if (rootDirHandle) {
                 if (parentHandle === rootDirHandle) {
                     newPath = renameName;
                 } else {
                     const parentPathArr = await rootDirHandle.resolve(parentHandle);
                     if (parentPathArr) newPath = [...parentPathArr, renameName].join('/');
                 }
             }

             setFiles(prev => prev.map(f => {
                 if (f.name === oldName) {
                     if (f.path && newPath) {
                         const oldPathExpected = newPath.split('/').slice(0, -1).concat(oldName).join('/');
                         if (f.path !== oldPathExpected) return f;
                     }
                     return { ...f, name: renameName, path: newPath || f.path, handle: newHandle || f.handle };
                 }
                 return f;
             }));
        } else {
            // Directory rename
            await fileSystem.renameEntry(parentHandle, oldName, renameName, kind);
        }

        if (parentHandle === rootDirHandle) await refreshProjectFiles();
        showToast('Renamed successfully');

    } catch (e) {
        console.error("Rename failed", e);
        showToast('Rename failed');
    }
    setRenameTarget(null);
  };

  const handleRestoreFile = async (fileName: string) => {
      if (!rootDirHandle || !isRecycleBinActive) return;
      try {
          const trashHandle = await rootDirHandle.getDirectoryHandle(TRASH_DIR_NAME);
          
          let kind: 'file' | 'directory' = 'file';
          try {
              await trashHandle.getFileHandle(fileName);
          } catch {
              kind = 'directory';
          }

          await fileSystem.moveEntry(trashHandle, fileName, rootDirHandle, kind);
          await refreshProjectFiles();
          showToast('File Restored');
      } catch (e) { console.error("Restore failed", e); showToast('Restore failed'); }
  };

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault(); e.stopPropagation(); handleSave();
      }

      if (e.key === 'F2' && activeFileId && rootDirHandle) {
          e.preventDefault();
          const file = files.find(f => f.id === activeFileId);
          if (file) {
               try {
                   let parentHandle = rootDirHandle;
                   if (file.path) {
                       const parts = file.path.split('/');
                       parts.pop();
                       for (const part of parts) {
                           parentHandle = await parentHandle.getDirectoryHandle(part);
                       }
                   }
                   handleRenameRequest(file.name, 'file', parentHandle);
               } catch(err) {
                   console.error("Failed to prepare rename", err);
               }
          }
      }
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [activeFileId, files, rootDirHandle]);

  if (!rootDirHandle && !isLoadingRecents) {
      return <WelcomeScreen recentFolders={recentFolders} onOpenFolder={handleOpenFolder} onOpenRecent={handleOpenRecent} />;
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-white dark:bg-[#1e1e1e] text-gray-900 dark:text-[#cccccc] overflow-hidden relative transition-colors duration-300">
      <Toast message={toast.message} visible={toast.visible} />
      
      {deleteTarget && (
        <Modal title={isRecycleBinActive ? "Delete Forever" : `Delete ${deleteTarget.kind === 'directory' ? 'Folder' : 'File'}`} onClose={() => setDeleteTarget(null)} onConfirm={confirmDelete} confirmText="Delete" confirmColor="bg-red-600 hover:bg-red-700">
            <p>Are you sure you want to {isRecycleBinActive ? 'permanently ' : ''}delete <span className="font-bold text-gray-900 dark:text-white">"{deleteTarget.name}"</span>?</p>
            {!isRecycleBinActive && <p className="text-xs text-gray-500 mt-2">Item will be moved to Recycle Bin.</p>}
        </Modal>
      )}

      {renameTarget && (
        <Modal title="Rename" onClose={() => setRenameTarget(null)} onConfirm={confirmRename} confirmText="Rename">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Enter new name for <span className="text-gray-900 dark:text-white">"{renameTarget.name}"</span>:</p>
            <input 
                autoFocus
                type="text" 
                className="w-full bg-gray-100 dark:bg-[#333333] text-gray-900 dark:text-[#cccccc] border border-gray-300 dark:border-[#3e3e42] p-2 rounded focus:outline-none focus:border-blue-500"
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && confirmRename()}
                onFocus={(e) => e.target.select()}
            />
        </Modal>
      )}

      <div className="h-10 bg-gray-100 dark:bg-[#333333] flex items-center justify-between px-3 select-none border-b border-gray-300 dark:border-none">
        <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 mr-4"><span className="font-bold text-blue-600 dark:text-blue-400">MD</span><span className="font-bold text-gray-800 dark:text-white">Pro</span></div>
            <button className="p-1 hover:bg-gray-200 dark:hover:bg-[#454545] rounded text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white" onClick={handleCloseFolder} title="Home / Close Folder"><Icons.Home size={16} /></button>
            <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-1"></div>
            <button className="p-1 hover:bg-gray-200 dark:hover:bg-[#454545] rounded text-gray-600 dark:text-gray-400" onClick={() => setSidebarVisible(!sidebarVisible)} title="Toggle Sidebar"><Icons.Sidebar size={16} /></button>
            <button className="p-1 hover:bg-gray-200 dark:hover:bg-[#454545] rounded text-gray-600 dark:text-gray-400" onClick={handleOpenFolder} title="Open Folder"><Icons.FolderOpen size={16} /></button>
            <button className="p-1 hover:bg-gray-200 dark:hover:bg-[#454545] rounded text-gray-600 dark:text-gray-400" onClick={handleSave} title="Save (Ctrl+S)"><Icons.Save size={16} className={activeFile?.isDirty ? 'text-yellow-500 dark:text-yellow-400' : ''} /></button>
            <button className="p-1 hover:bg-gray-200 dark:hover:bg-[#454545] rounded text-gray-600 dark:text-gray-400" onClick={() => handleCreateFile(undefined)} title="New File"><Icons.FileText size={16} /></button>
        </div>
        <div className="flex items-center gap-2">
             <span className="text-xs text-gray-500 mr-2">{activeFile?.name || 'No file'}</span>
             <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-2"></div>
             
             {/* Theme Toggle */}
             <button 
                onClick={toggleTheme}
                className="p-1 rounded hover:bg-gray-200 dark:hover:bg-[#454545] text-gray-600 dark:text-gray-400 transition-colors"
                title={theme === 'dark' ? "Switch to Light Mode" : "Switch to Dark Mode"}
             >
                {theme === 'dark' ? <Icons.Sun size={16} /> : <Icons.Moon size={16} />}
             </button>
             
             <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-2"></div>

             {/* View Mode Switcher */}
             <div className="flex bg-white dark:bg-[#1e1e1e] rounded p-0.5 border border-gray-300 dark:border-[#454545]">
                 <button 
                    onClick={() => setViewMode('editor')}
                    className={`p-1 rounded transition-colors ${viewMode === 'editor' ? 'bg-gray-100 dark:bg-[#3e3e42] text-black dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`} 
                    title="Source Editor"
                 >
                    <Icons.PenTool size={14} />
                 </button>
                 <button 
                    onClick={() => setViewMode('wysiwyg')}
                    className={`p-1 rounded transition-colors ${viewMode === 'wysiwyg' ? 'bg-gray-100 dark:bg-[#3e3e42] text-black dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`} 
                    title="WYSIWYG Editor"
                 >
                    <Icons.Type size={14} />
                 </button>
                 <button 
                    onClick={() => setViewMode('split')}
                    className={`p-1 rounded transition-colors ${viewMode === 'split' ? 'bg-gray-100 dark:bg-[#3e3e42] text-black dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`} 
                    title="Split View"
                 >
                    <Icons.Columns size={14} />
                 </button>
                 <button 
                    onClick={() => setViewMode('preview')}
                    className={`p-1 rounded transition-colors ${viewMode === 'preview' ? 'bg-gray-100 dark:bg-[#3e3e42] text-black dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`} 
                    title="Preview Only"
                 >
                    <Icons.Eye size={14} />
                 </button>
             </div>
        </div>
      </div>
      <div className="flex-1 flex overflow-hidden">
        {sidebarVisible && (
          <Sidebar 
            projectFiles={projectFiles} 
            activeFileId={activeFileId} 
            files={files}
            rootDirName={rootDirHandle?.name} 
            rootDirHandle={rootDirHandle}
            isRecycleBinActive={isRecycleBinActive}
            onOpenFolder={handleOpenFolder} 
            onCloseFolder={handleCloseFolder}
            onProjectFileSelect={handleProjectFileSelect} 
            onCreateFile={handleCreateFile}
            onCreateFolder={handleCreateFolder} 
            onDeleteFile={handleDeleteRequest} 
            onRenameFile={handleRenameRequest}
            onToggleRecycleBin={() => setIsRecycleBinActive(!isRecycleBinActive)}
            onRestoreFile={handleRestoreFile} 
            onFileSelect={() => {}} 
            onFileClose={() => {}} 
            onOpenFile={() => {}}
          />
        )}
        <div className="flex-1 flex flex-col min-w-0 bg-white dark:bg-[#1e1e1e]">
          <div className="flex overflow-x-auto bg-gray-100 dark:bg-[#252526] border-b border-gray-200 dark:border-[#252526] scrollbar-thin">
            {files.map(file => {
              const isDuplicate = files.filter(f => f.name === file.name).length > 1;
              let pathHint = '';
              if (isDuplicate && file.path) {
                  const parts = file.path.split('/');
                  pathHint = parts.length > 1 ? parts[parts.length - 2] : './';
              }

              return (
              <div key={file.id} onClick={() => setActiveFileId(file.id)} onContextMenu={(e) => handleTabContextMenu(e, file.id)} 
                className={`flex items-center gap-2 px-3 py-2 text-sm cursor-pointer min-w-[120px] max-w-[200px] border-r border-gray-200 dark:border-[#1e1e1e] select-none group 
                ${activeFileId === file.id 
                    ? 'bg-white dark:bg-[#1e1e1e] text-gray-900 dark:text-white border-t-2 border-t-blue-500' 
                    : 'bg-gray-200 dark:bg-[#2d2d2d] text-gray-500 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-[#2a2d2e]'}`} 
                title={file.path || file.name}>
                {isImageFile(file.name) ? (<Icons.File size={14} className="text-purple-500 dark:text-purple-400 shrink-0" />) : (<Icons.FileText size={14} className={`shrink-0 ${file.id === activeFileId ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'}`} />)}
                
                <div className="flex items-baseline min-w-0 overflow-hidden flex-1">
                    <span className="truncate">{file.name}</span>
                    {pathHint && <span className="ml-2 text-xs text-gray-400 truncate shrink-0 opacity-60">{pathHint}</span>}
                </div>

                <button onClick={(e) => handleCloseFile(file.id, e)} className="hover:bg-gray-300 dark:hover:bg-[#454545] rounded p-0.5 opacity-0 group-hover:opacity-100 shrink-0"><Icons.X size={12} className={file.isDirty ? 'text-black dark:text-white' : ''} /></button>
                {file.isDirty && activeFileId !== file.id && (<div className="w-2 h-2 rounded-full bg-gray-500 dark:bg-white ml-1 opacity-80 shrink-0" />)}
              </div>
            )})}
            <div className="flex-1 min-w-[50px] cursor-default" onDoubleClick={() => handleCreateFile(undefined)} title="Double-click to create new file"></div>
          </div>
          {tabContextMenu.visible && (
            <div className="fixed bg-white dark:bg-[#252526] border border-gray-200 dark:border-[#454545] shadow-xl rounded py-1 z-[9999] w-48 text-sm flex flex-col" style={{ top: tabContextMenu.y, left: tabContextMenu.x }} onClick={(e) => e.stopPropagation()}>
              <button className="text-left px-4 py-1.5 hover:bg-blue-600 hover:text-white text-gray-700 dark:text-[#cccccc]" onClick={() => handleTabAction('close')}>Close</button>
              <button className="text-left px-4 py-1.5 hover:bg-blue-600 hover:text-white text-gray-700 dark:text-[#cccccc]" onClick={() => handleTabAction('closeOthers')}>Close Others</button>
              <div className="border-t border-gray-200 dark:border-[#3e3e42] my-1"></div>
              <button className="text-left px-4 py-1.5 hover:bg-blue-600 hover:text-white text-gray-700 dark:text-[#cccccc]" onClick={() => handleTabAction('closeAll')}>Close All</button>
            </div>
          )}
          {activeFile ? (
            <div className="flex-1 flex overflow-hidden relative">
              {isImageFile(activeFile.name) ? (<div className="flex-1 h-full"><ImageViewer file={activeFile} /></div>) : (
                  <React.Fragment>
                      {/* Editor View: Visible if 'editor' or 'split' */}
                      {(viewMode === 'editor' || viewMode === 'split') && (
                          <div className={`flex-1 min-w-0 h-full ${viewMode === 'split' ? 'border-r border-gray-200 dark:border-[#3e3e42]' : ''}`}>
                            <EditorPane 
                                fileId={activeFile.id} 
                                content={activeFile.content} 
                                initialCursorPosition={activeFile.cursorPosition}
                                theme={theme}
                                onChange={handleContentChange} 
                                onCursorChange={handleCursorChange}
                                onSave={handleSave} 
                                onPasteImage={handlePasteImage} 
                                onFileLinkClick={handleLinkClick} 
                                scrollToAnchor={pendingScrollAnchor} 
                                rootDirHandle={rootDirHandle}
                                filePath={activeFile.path || activeFile.name}
                            />
                          </div>
                      )}
                      
                      {/* WYSIWYG Editor: Visible if 'wysiwyg' */}
                      {viewMode === 'wysiwyg' && (
                          <div className="flex-1 min-w-0 h-full bg-white dark:bg-[#1e1e1e]">
                             <WysiwygEditor 
                                content={activeFile.content}
                                onChange={handleContentChange}
                                rootDirHandle={rootDirHandle}
                                filePath={activeFile.path || activeFile.name}
                                onPasteImage={handlePasteImage}
                             />
                          </div>
                      )}
                      
                      {/* Preview View: Visible if 'preview' or 'split' */}
                      {(viewMode === 'preview' || viewMode === 'split') && (
                        <div className="flex-1 min-w-0 h-full bg-white dark:bg-[#1e1e1e]">
                            <MarkdownPreview 
                                content={activeFile.content} 
                                rootDirHandle={rootDirHandle} 
                                filePath={activeFile.path || activeFile.name} 
                                onFileLinkClick={handleLinkClick} 
                                scrollToAnchor={pendingScrollAnchor} 
                            />
                        </div>
                      )}
                  </React.Fragment>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-500 dark:text-[#555555]">
                <div className="text-6xl mb-4 opacity-20"><Icons.FolderOpen /></div>
                <p className="text-lg">Open a folder to start project</p>
                <button onClick={handleOpenFolder} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Open Folder</button>
            </div>
          )}
        </div>
      </div>
      <div className="h-6 bg-blue-600 dark:bg-[#007acc] text-white text-xs flex items-center justify-between px-3 select-none">
        <div className="flex gap-4"><span className="flex items-center gap-1"><Icons.Split size={10}/> {rootDirHandle ? rootDirHandle.name : 'No Folder'}</span><span>{files.length > 0 ? `${files.length} editors` : ''}</span></div>
        <div className="flex gap-4">
            {activeFile?.cursorPosition && viewMode === 'editor' && (
                <span className="mr-2">Ln {activeFile.cursorPosition.lineNumber}, Col {activeFile.cursorPosition.column}</span>
            )}
            <span>{activeFile ? (isImageFile(activeFile.name) ? 'Image' : 'Markdown') : 'None'}</span><span>UTF-8</span>
        </div>
      </div>
    </div>
  );
};

export default App;