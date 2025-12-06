import { FileSystemFileHandle, FileSystemDirectoryHandle, FileSystemHandle } from '../types';

export const fileSystem = {
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
      return await (window as any).showDirectoryPicker({
        mode: 'readwrite',
      });
    }
    throw new Error("Directory access not supported in this browser");
  },

  /**
   * List all files in a directory (shallow)
   */
  async listFiles(dirHandle: FileSystemDirectoryHandle): Promise<FileSystemHandle[]> {
    const files: FileSystemHandle[] = [];
    // @ts-ignore - TS definitions for async iterator on DOM types can be tricky
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file') { // Currently only listing files, ignoring subdirs for MVP
         files.push(entry);
      }
    }
    return files.sort((a, b) => a.name.localeCompare(b.name));
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
   * Save as new file (legacy/single file mode)
   */
  async saveFileAs(content: string, suggestedName: string = 'Untitled.md'): Promise<{ handle: FileSystemFileHandle | undefined; name: string }> {
     // 1. Try Native API
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
    
     // 2. Fallback: Download Blob
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
