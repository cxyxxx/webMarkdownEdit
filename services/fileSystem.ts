
import { FileSystemFileHandle, FileSystemDirectoryHandle, FileSystemHandle } from '../types';

const DB_NAME = 'MDPro_DB';
const DB_VERSION = 1;
const STORE_NAME = 'recent_folders';

export interface RecentFolder {
    id: string; // usually the name for now, or a uuid
    name: string;
    handle: FileSystemDirectoryHandle;
    lastAccessed: number;
}

// Database Helper
const getDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'name' }); // Using name as key for simplicity in this context
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

export const fileSystem = {
  /**
   * Save a directory handle to recents
   */
  async addToRecents(handle: FileSystemDirectoryHandle): Promise<void> {
      try {
          const db = await getDB();
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          
          const item: RecentFolder = {
              id: handle.name,
              name: handle.name,
              handle: handle,
              lastAccessed: Date.now()
          };
          
          store.put(item);
          return new Promise((resolve) => {
              tx.oncomplete = () => resolve();
          });
      } catch (e) {
          console.warn("Failed to save to recents DB", e);
      }
  },

  /**
   * Get all recent folders
   */
  async getRecents(): Promise<RecentFolder[]> {
      try {
          const db = await getDB();
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const request = store.getAll();
          
          return new Promise((resolve) => {
              request.onsuccess = () => {
                  const results = request.result as RecentFolder[];
                  // Sort by lastAccessed descending
                  resolve(results.sort((a, b) => b.lastAccessed - a.lastAccessed));
              };
          });
      } catch (e) {
          console.warn("Failed to load recents", e);
          return [];
      }
  },

  /**
   * Remove a folder from recents
   */
  async removeFromRecents(name: string): Promise<void> {
      try {
          const db = await getDB();
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          store.delete(name);
          return new Promise((resolve) => {
              tx.oncomplete = () => resolve();
          });
      } catch (e) { console.error(e); }
  },

  /**
   * Open a file picker and return the handle and content
   */
  async openFile(): Promise<{ handle: FileSystemFileHandle | undefined; content: string; name: string }> {
    // 1. Try Native File System Access API
    if ('showOpenFilePicker' in window) {
      try {
        const [handle] = await (window as any).showOpenFilePicker({
          types: [
            {
              description: 'Markdown Files',
              accept: {
                'text/markdown': ['.md', '.markdown', '.txt'],
              },
            },
          ],
          multiple: false,
        });

        const file = await handle.getFile();
        const content = await file.text();

        return {
          handle: handle as FileSystemFileHandle,
          content,
          name: file.name,
        };
      } catch (err: any) {
        if (err.name === 'AbortError') throw err;
        console.warn("Native file picker failed. Falling back.", err);
      }
    }

    // 2. Fallback: Legacy <input type="file">
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.md,.markdown,.txt';
      input.style.display = 'none';
      document.body.appendChild(input);

      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
           const content = await file.text();
           document.body.removeChild(input);
           resolve({
             handle: undefined,
             content,
             name: file.name,
           });
        } else {
           document.body.removeChild(input);
           reject(new Error("No file selected"));
        }
      };

      input.click();
    });
  },

  /**
   * Open a directory picker
   */
  async openDirectory(): Promise<FileSystemDirectoryHandle> {
    if ('showDirectoryPicker' in window) {
      const handle = await (window as any).showDirectoryPicker({
        mode: 'readwrite',
      });
      // Automatically add to recents
      await this.addToRecents(handle);
      return handle;
    }
    throw new Error("Directory access not supported in this browser");
  },

  /**
   * List all files and folders in a directory (shallow)
   */
  async listFiles(dirHandle: FileSystemDirectoryHandle): Promise<FileSystemHandle[]> {
    const entries: FileSystemHandle[] = [];
    // @ts-ignore
    for await (const entry of dirHandle.values()) {
      entries.push(entry);
    }
    // Sort: Folders first, then files. Alphabetical within groups.
    return entries.sort((a, b) => {
      if (a.kind === b.kind) return a.name.localeCompare(b.name);
      return a.kind === 'directory' ? -1 : 1;
    });
  },

  /**
   * Read text from a file handle
   */
  async readFile(handle: FileSystemFileHandle): Promise<string> {
    const file = await handle.getFile();
    return await file.text();
  },

  /**
   * Save content to a file handle
   */
  async saveFile(handle: FileSystemFileHandle, content: string | Blob): Promise<void> {
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
  },

  /**
   * Create a new file in a directory
   */
  async createFileInDir(dirHandle: FileSystemDirectoryHandle, name: string, content: string | Blob = ''): Promise<FileSystemFileHandle> {
    const fileHandle = await dirHandle.getFileHandle(name, { create: true });
    await this.saveFile(fileHandle, content);
    return fileHandle;
  },

  /**
   * Create a new directory in a directory
   */
  async createDirectory(dirHandle: FileSystemDirectoryHandle, name: string): Promise<FileSystemDirectoryHandle> {
    return await dirHandle.getDirectoryHandle(name, { create: true });
  },

  /**
   * Move an entry (Copy and Delete)
   * Supports both files and directories.
   */
  async moveEntry(
    sourceDir: FileSystemDirectoryHandle, 
    name: string, 
    targetDir: FileSystemDirectoryHandle, 
    kind: 'file' | 'directory',
    newName?: string
  ): Promise<void> {
    const targetName = newName || name;

    if (kind === 'file') {
        const sourceFileHandle = await sourceDir.getFileHandle(name);
        const file = await sourceFileHandle.getFile();
        
        // Create in new location
        const targetFileHandle = await targetDir.getFileHandle(targetName, { create: true });
        const writable = await targetFileHandle.createWritable();
        await writable.write(file);
        await writable.close();

        // Remove from old location
        await sourceDir.removeEntry(name);
    } else {
        // Directory Move (Recursive Copy + Delete)
        const sourceHandle = await sourceDir.getDirectoryHandle(name);
        const targetHandle = await targetDir.getDirectoryHandle(targetName, { create: true });
        
        await this.copyDirectory(sourceHandle, targetHandle);
        await sourceDir.removeEntry(name, { recursive: true });
    }
  },

  /**
   * Rename an entry (file or directory)
   */
  async renameEntry(
    parentHandle: FileSystemDirectoryHandle, 
    oldName: string, 
    newName: string, 
    kind: 'file' | 'directory'
  ): Promise<void> {
      // Try native move first if available (Chrome 113+)
      let handle: FileSystemHandle;
      try {
        if (kind === 'file') {
            handle = await parentHandle.getFileHandle(oldName);
        } else {
            handle = await parentHandle.getDirectoryHandle(oldName);
        }
        
        // @ts-ignore
        if (handle.move) {
             // @ts-ignore
             await handle.move(parentHandle, newName);
             return;
        }
      } catch (e) {
          // If getting handle fails, propagate error
          throw e;
      }

      // Fallback: Manual Move
      await this.moveEntry(parentHandle, oldName, parentHandle, kind, newName);
  },

  /**
   * Recursive Copy Directory Helper
   */
  async copyDirectory(source: FileSystemDirectoryHandle, target: FileSystemDirectoryHandle) {
    // @ts-ignore
    for await (const entry of source.values()) {
        if (entry.kind === 'file') {
            const fileHandle = await source.getFileHandle(entry.name);
            const file = await fileHandle.getFile();
            const targetFileHandle = await target.getFileHandle(entry.name, { create: true });
            const writable = await targetFileHandle.createWritable();
            await writable.write(file);
            await writable.close();
        } else if (entry.kind === 'directory') {
            const subSource = await source.getDirectoryHandle(entry.name);
            const subTarget = await target.getDirectoryHandle(entry.name, { create: true });
            await this.copyDirectory(subSource, subTarget);
        }
    }
  },

  /**
   * Save as new file (legacy/single file mode)
   */
  async saveFileAs(content: string, suggestedName: string = 'Untitled.md'): Promise<{ handle: FileSystemFileHandle | undefined; name: string }> {
     if ('showSaveFilePicker' in window) {
       try {
         const handle = await (window as any).showSaveFilePicker({
           suggestedName,
           types: [{
             description: 'Markdown File',
             accept: {'text/markdown': ['.md']},
           }],
         });
         
         const writable = await handle.createWritable();
         await writable.write(content);
         await writable.close();
    
         return {
           handle: handle as FileSystemFileHandle,
           name: handle.name
         };
       } catch (err: any) {
         if (err.name === 'AbortError') throw err;
       }
     }
    
     const blob = new Blob([content], { type: 'text/markdown' });
     const url = URL.createObjectURL(blob);
     const a = document.createElement('a');
     a.href = url;
     a.download = suggestedName;
     a.style.display = 'none';
     document.body.appendChild(a);
     a.click();
     
     setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
     }, 100);

     return {
       handle: undefined,
       name: suggestedName
     };
  }
};
