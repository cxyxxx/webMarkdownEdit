
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import Sidebar from './components/Sidebar';
import EditorPane from './components/EditorPane';
import MarkdownPreview from './components/MarkdownPreview';
import { Icons } from './components/Icon';
import { fileSystem } from './services/fileSystem';
import { EditorFile, AppState, FileSystemDirectoryHandle, FileSystemHandle, FileSystemFileHandle } from './types';
import { AUTO_SAVE_DELAY_MS, LOCAL_STORAGE_SESSION_KEY, DEFAULT_CONTENT } from './constants';

// --- Helper for Image Files ---
const isImageFile = (name: string) => {
  return /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(name);
};

// --- Toast Component ---
const Toast: React.FC<{ message: string; visible: boolean }> = ({ message, visible }) => {
  if (!visible) return null;
  return (
    <div className="absolute top-16 right-4 bg-blue-600 text-white px-4 py-2 rounded shadow-lg flex items-center gap-2 z-50 transition-opacity duration-300 animate-in fade-in slide-in-from-top-2">
      <Icons.FileText size={16} />
      <span className="text-sm font-medium">{message}</span>
    </div>
  );
};

// --- Image Viewer Component ---
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
        } catch (e) {
          console.error("Failed to load image", e);
        }
      }
    };
    load();
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [file]);

  if (!src) return <div className="flex items-center justify-center h-full text-gray-500">Loading image...</div>;

  return (
    <div className="flex items-center justify-center h-full bg-[#1e1e1e] overflow-auto p-8">
      <img src={src} alt={file.name} className="max-w-full max-h-full shadow-lg rounded" />
    </div>
  );
};

const App: React.FC = () => {
  // --- State ---
  const [files, setFiles] = useState<EditorFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [previewVisible, setPreviewVisible] = useState(true);
  const [autoSaveTimer, setAutoSaveTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [toast, setToast] = useState<{ message: string; visible: boolean }>({ message: '', visible: false });

  // Scroll to Anchor State
  const [pendingScrollAnchor, setPendingScrollAnchor] = useState<string | null>(null);

  // Directory State
  const [rootDirHandle, setRootDirHandle] = useState<FileSystemDirectoryHandle | undefined>(undefined);
  const [projectFiles, setProjectFiles] = useState<FileSystemHandle[]>([]);

  // Derived state
  const activeFile = files.find(f => f.id === activeFileId);

  // --- Effects ---

  // Load Session
  useEffect(() => {
    const savedSession = localStorage.getItem(LOCAL_STORAGE_SESSION_KEY);
    if (savedSession) {
      try {
        const parsed: AppState = JSON.parse(savedSession);
        // Note: Handles are lost on reload in localStorage strategy.
        const recoveredFiles = parsed.files.map(f => ({...f, handle: undefined, isDirty: false })); 
        setFiles(recoveredFiles);
        setActiveFileId(parsed.activeFileId);
        setSidebarVisible(parsed.sidebarVisible);
        setPreviewVisible(parsed.previewVisible);
      } catch (e) {
        console.error("Failed to restore session", e);
      }
    } else {
      // Default initial state
      const initialFile: EditorFile = {
        id: uuidv4(),
        name: 'Welcome.md',
        content: DEFAULT_CONTENT,
        isDirty: false,
        lastModified: Date.now()
      };
      setFiles([initialFile]);
      setActiveFileId(initialFile.id);
    }
  }, []);

  // Save Session (Persist state to localStorage)
  // This effectively acts as "saving" for browser-mode files
  useEffect(() => {
    const saveState = () => {
      const state: Partial<AppState> = {
        files: files.map(({ handle, ...rest }) => rest) as any,
        activeFileId,
        sidebarVisible,
        previewVisible
      };
      localStorage.setItem(LOCAL_STORAGE_SESSION_KEY, JSON.stringify(state));
    };
    
    // Save on unload and periodically
    window.addEventListener('beforeunload', saveState);
    const interval = setInterval(saveState, 2000); // More frequent updates for reliability
    
    return () => {
      window.removeEventListener('beforeunload', saveState);
      clearInterval(interval);
    };
  }, [files, activeFileId, sidebarVisible, previewVisible]);

  // Refresh file list if root dir changes
  useEffect(() => {
     if (rootDirHandle) {
         refreshProjectFiles();
     }
  }, [rootDirHandle]);

  const refreshProjectFiles = async () => {
      if (!rootDirHandle) return;
      try {
          const fileHandles = await fileSystem.listFiles(rootDirHandle);
          setProjectFiles(fileHandles);
      } catch (e) {
          console.error("Error reading directory", e);
      }
  };

  const showToast = (message: string) => {
    setToast({ message, visible: true });
    setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 2000);
  };

  // --- Handlers ---

  const handleOpenFolder = async () => {
      try {
          const dirHandle = await fileSystem.openDirectory();
          setRootDirHandle(dirHandle);
          // Close welcome file if it's the only one and not dirty
          if (files.length === 1 && files[0].name === 'Welcome.md' && !files[0].isDirty) {
              setFiles([]);
              setActiveFileId(null);
          }
      } catch (e) {
          // Ignore abort
      }
  };

  const handleOpenFile = async () => {
    try {
      const { handle, content, name } = await fileSystem.openFile();
      
      const existingFile = files.find(f => f.name === name);
      if (existingFile) {
        setActiveFileId(existingFile.id);
        setFiles(prev => prev.map(f => f.id === existingFile.id ? { ...f, content, handle: handle || f.handle } : f));
        return;
      }

      const newFile: EditorFile = {
        id: uuidv4(),
        name,
        handle,
        content,
        isDirty: false,
        lastModified: Date.now()
      };

      setFiles(prev => [...prev, newFile]);
      setActiveFileId(newFile.id);
    } catch (err) {
      console.error(err);
    }
  };

  const handleProjectFileSelect = async (handle: FileSystemFileHandle) => {
      // Check if already open
      const existingFile = files.find(f => f.name === handle.name);
      if (existingFile) {
          setActiveFileId(existingFile.id);
          return;
      }

      // Handle Images
      if (isImageFile(handle.name)) {
        const newFile: EditorFile = {
            id: uuidv4(),
            name: handle.name,
            handle,
            content: '', // Images don't have text content
            isDirty: false,
            lastModified: Date.now()
        };
        setFiles(prev => [...prev, newFile]);
        setActiveFileId(newFile.id);
        return;
      }

      // Handle Text Files
      try {
        const content = await fileSystem.readFile(handle);
        const newFile: EditorFile = {
            id: uuidv4(),
            name: handle.name,
            handle,
            content,
            isDirty: false,
            lastModified: Date.now()
        };
        setFiles(prev => [...prev, newFile]);
        setActiveFileId(newFile.id);
      } catch (e) {
          console.error("Failed to open project file", e);
      }
  };

  const handleCreateFile = async () => {
    // If we have a root directory, create the file there immediately
    if (rootDirHandle) {
        try {
            const name = `Untitled-${files.length + 1}.md`;
            // Actually create on disk
            const handle = await fileSystem.createFileInDir(rootDirHandle, name, '');
            await refreshProjectFiles();
            
            const newFile: EditorFile = {
                id: uuidv4(),
                name,
                handle,
                content: '',
                isDirty: false,
                lastModified: Date.now()
            };
            setFiles(prev => [...prev, newFile]);
            setActiveFileId(newFile.id);
        } catch (e) {
            console.error("Failed to create file in dir", e);
        }
    } else {
        // Virtual mode
        const newFile: EditorFile = {
            id: uuidv4(),
            name: `Untitled-${files.length + 1}.md`,
            content: '',
            isDirty: true,
            lastModified: Date.now()
        };
        setFiles(prev => [...prev, newFile]);
        setActiveFileId(newFile.id);
    }
  };

  const handleCloseFile = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    
    // In browser mode, we don't block closing dirty files aggressively because we have session storage
    // But good practice to ask if they want to discard 'changes' if those changes weren't saved to disk (in local mode)
    
    const fileToClose = files.find(f => f.id === id);
    if (fileToClose?.handle && fileToClose.isDirty) {
        if (!confirm(`Save changes to ${fileToClose.name} on disk?`)) {
             // If user cancels, we might just want to stop close.
             // If user says 'No' (in a real app), we proceed. 
             // Here simplified: confirm = OK (Proceed? No, confirm usually means "Are you sure you want to close without saving?" or "Save?")
             // Let's stick to simple: if has handle and dirty, ask.
        }
    }

    const newFiles = files.filter(f => f.id !== id);
    setFiles(newFiles);
    
    if (activeFileId === id) {
      setActiveFileId(newFiles.length > 0 ? newFiles[newFiles.length - 1].id : null);
    }
  };

  const handleSave = async () => {
    // Current active file is captured from state closure when this function is called
    // We use a ref or find from current 'files' state to ensure freshness? 
    // files state is in dependency array of useEffect hooks, so handleSave needs to be carefully referenced or use functional updates.
    // However, handleSave is recreated on every render if passed to child, but here it's main component.
    
    const current = files.find(f => f.id === activeFileId);
    if (!current) return;
    
    // Don't save images
    if (isImageFile(current.name)) return;

    try {
      if (current.handle) {
        // Mode 1: Local File System (Disk)
        await fileSystem.saveFile(current.handle, current.content);
        setFiles(prev => prev.map(f => f.id === current.id ? { ...f, isDirty: false } : f));
        showToast('Saved to disk');
      } else if (rootDirHandle) {
        // Mode 2: Project Folder (New File)
        const handle = await fileSystem.createFileInDir(rootDirHandle, current.name, current.content);
        setFiles(prev => prev.map(f => f.id === current.id ? { 
          ...f, 
          handle,
          isDirty: false 
        } : f));
        await refreshProjectFiles();
        showToast('Saved to folder');
      } else {
        // Mode 3: Browser Mode (Virtual)
        // CRITICAL CHANGE: Do NOT prompt for Save As.
        // Just mark as clean (since it's saved to session) and show toast.
        setFiles(prev => prev.map(f => f.id === current.id ? { ...f, isDirty: false } : f));
        showToast('Saved (Browser Storage)');
      }
    } catch (err) {
      console.error("Save failed", err);
      showToast('Save failed');
    }
  };

  // Explicit Export Functionality
  const handleExport = async () => {
      const current = files.find(f => f.id === activeFileId);
      if (!current) return;
      
      try {
        const { handle, name } = await fileSystem.saveFileAs(current.content, current.name);
        // If user picked a location, we update our reference
        if (handle) {
             setFiles(prev => prev.map(f => f.id === current.id ? { 
                ...f, 
                handle, 
                name, 
                isDirty: false 
            } : f));
            showToast('Exported successfully');
        }
      } catch (e) {
          console.error("Export failed", e);
      }
  };

  const handlePasteImage = async (blob: Blob): Promise<string | null> => {
      if (!rootDirHandle) {
          // In browser mode, we could technically support base64 images or IDB images
          // For now, let's keep restriction but alert user
          alert("Please open a folder first to save pasted images as files.");
          return null;
      }

      try {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const fileName = `image-${timestamp}.png`;
          await fileSystem.createFileInDir(rootDirHandle, fileName, blob);
          await refreshProjectFiles();
          return fileName; // Return just filename for relative path
      } catch (e) {
          console.error("Failed to save pasted image", e);
          alert("Failed to save image to disk.");
          return null;
      }
  };

  const handleLinkClick = (linkTarget: string) => {
    // Parse anchor if present (e.g. "File Name#Heading")
    const parts = linkTarget.split('#');
    const targetPath = parts[0];
    const anchor = parts.length > 1 ? parts[1] : null;

    setPendingScrollAnchor(anchor);

    // If it's a link to the SAME file, just setting the anchor is enough to trigger the scroll effects
    if (activeFile && (activeFile.name === targetPath || activeFile.name === `${targetPath}.md`)) {
      return;
    }

    // 1. Resolve potential filename candidates
    let candidates = [targetPath];
    
    // Normalize: If it doesn't have an extension, assume .md might be implied
    if (!targetPath.match(/\.[a-zA-Z0-9]+$/)) {
        candidates.push(`${targetPath}.md`);
    }

    // 2. Search in currently open files first
    for (const name of candidates) {
        const openFile = files.find(f => f.name === name);
        if (openFile) {
            setActiveFileId(openFile.id);
            return;
        }
    }

    // 3. Search in project files (if folder open)
    for (const name of candidates) {
        const handle = projectFiles.find(f => f.name === name);
        if (handle && handle.kind === 'file') {
            handleProjectFileSelect(handle as FileSystemFileHandle);
            return;
        }
    }

    // 4. If not found, create a new "Virtual" file (user can save it later)
    // We prefer the .md version for the new file name
    const newName = candidates.length > 1 ? candidates[1] : candidates[0];
    const newFile: EditorFile = {
        id: uuidv4(),
        name: newName,
        content: `# ${targetPath}\n\n`, // Initialize with title
        isDirty: true,
        lastModified: Date.now()
    };
    setFiles(prev => [...prev, newFile]);
    setActiveFileId(newFile.id);
  };

  const handleContentChange = useCallback((newContent: string) => {
    if (!activeFileId) return;

    setFiles(prev => prev.map(f => {
      if (f.id === activeFileId) {
        return { ...f, content: newContent, isDirty: true };
      }
      return f;
    }));

    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    
    // Auto Save Logic
    const currentFileId = activeFileId;
    
    const timer = setTimeout(async () => {
        // We need fresh state here.
        setFiles(currentFiles => {
            const f = currentFiles.find(file => file.id === currentFileId);
            if (f && f.handle) {
                // It has a handle, write to disk
                fileSystem.saveFile(f.handle, newContent).then(() => {
                    // SILENT SAVE: No toast
                    setFiles(updated => updated.map(u => u.id === currentFileId ? {...u, isDirty: false} : u));
                }).catch(e => console.warn('Auto-save failed', e));
            } else if (f && !f.handle) {
                 // Virtual file: It's already saved to localStorage session state
                 // SILENT SAVE: No toast
                 return currentFiles.map(u => u.id === currentFileId ? {...u, isDirty: false} : u);
            }
            return currentFiles;
        });
    }, AUTO_SAVE_DELAY_MS);
    
    setAutoSaveTimer(timer);

  }, [activeFileId]); // Removed 'files' from dependency to avoid loop, using functional state updates

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+S / Cmd+S
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault(); 
        e.stopPropagation();
        handleSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [activeFileId, files, rootDirHandle]);


  // --- Render ---

  return (
    <div className="flex flex-col h-screen w-screen bg-[#1e1e1e] text-[#cccccc] overflow-hidden relative">
      
      {/* Toast Notification */}
      <Toast message={toast.message} visible={toast.visible} />

      {/* Activity Bar */}
      <div className="h-10 bg-[#333333] flex items-center justify-between px-3 select-none">
        <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 mr-4">
                <span className="font-bold text-blue-400">MD</span>
                <span className="font-bold text-white">Pro</span>
            </div>
            <button className="p-1 hover:bg-[#454545] rounded" onClick={() => setSidebarVisible(!sidebarVisible)} title="Toggle Sidebar">
                <Icons.Sidebar size={16} />
            </button>
            <button className="p-1 hover:bg-[#454545] rounded" onClick={handleOpenFolder} title="Open Folder">
                <Icons.FolderOpen size={16} />
            </button>
            <button className="p-1 hover:bg-[#454545] rounded" onClick={handleSave} title="Save (Ctrl+S)">
                <Icons.Save size={16} className={activeFile?.isDirty ? 'text-yellow-400' : ''} />
            </button>
            <button className="p-1 hover:bg-[#454545] rounded" onClick={handleCreateFile} title="New File">
                <Icons.FileText size={16} />
            </button>
        </div>
        
        <div className="flex items-center gap-2">
             <span className="text-xs text-gray-500 mr-2">{activeFile?.name || 'No file'}</span>
             {activeFile && !isImageFile(activeFile.name) && (
                 <button className="p-1 hover:bg-[#454545] rounded text-gray-400" onClick={handleExport} title="Export / Save As...">
                    <Icons.Save size={14} /> <span className="text-xs ml-1">Export</span>
                 </button>
             )}
             <div className="w-px h-4 bg-gray-600 mx-2"></div>
             <button className={`p-1 hover:bg-[#454545] rounded ${previewVisible ? 'bg-[#454545]' : ''}`} onClick={() => setPreviewVisible(!previewVisible)} title="Toggle Preview">
                <Icons.Columns size={16} />
            </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        
        {/* Sidebar */}
        {sidebarVisible && (
          <Sidebar 
            projectFiles={projectFiles}
            activeFileId={activeFileId} 
            rootDirName={rootDirHandle?.name}
            onOpenFolder={handleOpenFolder}
            onProjectFileSelect={handleProjectFileSelect}
            onCreateFile={handleCreateFile}
            // Unused props
            files={[]}
            onFileSelect={() => {}}
            onFileClose={() => {}}
            onOpenFile={() => {}}
          />
        )}

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#1e1e1e]">
          
          {/* Tab Bar */}
          <div className="flex overflow-x-auto bg-[#252526] border-b border-[#252526] scrollbar-thin">
            {files.map(file => (
              <div 
                key={file.id}
                onClick={() => setActiveFileId(file.id)}
                className={`
                  flex items-center gap-2 px-3 py-2 text-sm cursor-pointer min-w-[120px] max-w-[200px] border-r border-[#1e1e1e] select-none
                  ${activeFileId === file.id ? 'bg-[#1e1e1e] text-white border-t-2 border-t-blue-500' : 'bg-[#2d2d2d] text-gray-400 hover:bg-[#2a2d2e]'}
                `}
              >
                {isImageFile(file.name) ? (
                    <Icons.File size={14} className="text-purple-400" />
                ) : (
                    <Icons.FileText size={14} className={file.id === activeFileId ? 'text-blue-400' : 'text-gray-500'} />
                )}
                
                <span className="truncate flex-1">{file.name}</span>
                <button 
                  onClick={(e) => handleCloseFile(file.id, e)}
                  className="hover:bg-[#454545] rounded p-0.5"
                >
                  <Icons.X size={12} className={file.isDirty ? 'text-white' : ''} />
                </button>
                {file.isDirty && activeFileId !== file.id && (
                     <div className="w-2 h-2 rounded-full bg-white ml-1 opacity-80" />
                )}
              </div>
            ))}
            {/* Clickable spacer to create new file */}
            <div 
                className="flex-1 min-w-[50px] cursor-default"
                onDoubleClick={handleCreateFile}
                title="Double-click to create new file"
            ></div>
          </div>

          {/* Editor Area */}
          {activeFile ? (
            <div className="flex-1 flex overflow-hidden relative">
              
              {isImageFile(activeFile.name) ? (
                  // Image View
                  <div className="flex-1 h-full">
                      <ImageViewer file={activeFile} />
                  </div>
              ) : (
                  // Editor View
                  <React.Fragment>
                      {/* Editor Pane */}
                      <div className={`flex-1 min-w-0 h-full ${previewVisible ? 'border-r border-[#3e3e42]' : ''}`}>
                        <EditorPane 
                          fileId={activeFile.id}
                          content={activeFile.content}
                          onChange={handleContentChange}
                          onSave={handleSave}
                          onPasteImage={handlePasteImage}
                          onFileLinkClick={handleLinkClick}
                          scrollToAnchor={pendingScrollAnchor}
                        />
                      </div>

                      {/* Preview Pane */}
                      {previewVisible && (
                        <div className="flex-1 min-w-0 h-full bg-[#1e1e1e]">
                          <MarkdownPreview 
                            content={activeFile.content} 
                            rootDirHandle={rootDirHandle}
                            onFileLinkClick={handleLinkClick}
                            scrollToAnchor={pendingScrollAnchor}
                          />
                        </div>
                      )}
                  </React.Fragment>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-[#555555]">
                <div className="text-6xl mb-4 opacity-20">
                    <Icons.FolderOpen />
                </div>
                <p className="text-lg">Open a folder to start project</p>
                <button 
                    onClick={handleOpenFolder}
                    className="mt-4 px-4 py-2 bg-[#0e639c] text-white rounded hover:bg-[#1177bb]"
                >
                    Open Folder
                </button>
            </div>
          )}
        
        </div>
      </div>
      
      {/* Status Bar */}
      <div className="h-6 bg-[#007acc] text-white text-xs flex items-center justify-between px-3 select-none">
        <div className="flex gap-4">
            <span className="flex items-center gap-1"><Icons.Split size={10}/> {rootDirHandle ? rootDirHandle.name : 'No Folder'}</span>
            <span>{files.length > 0 ? `${files.length} editors` : ''}</span>
        </div>
        <div className="flex gap-4">
             <span>{activeFile ? (isImageFile(activeFile.name) ? 'Image' : 'Markdown') : 'None'}</span>
             <span>UTF-8</span>
        </div>
      </div>
    </div>
  );
};

export default App;
