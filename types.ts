
// Standard definitions for File System Access API
// These are often missing in default TS configs
export interface FileSystemHandle {
  kind: 'file' | 'directory';
  name: string;
  isSameEntry(other: FileSystemHandle): Promise<boolean>;
}

export interface FileSystemFileHandle extends FileSystemHandle {
  kind: 'file';
  getFile(): Promise<File>;
  createWritable(options?: any): Promise<FileSystemWritableFileStream>;
}

export interface FileSystemDirectoryHandle extends FileSystemHandle {
  kind: 'directory';
  resolve(possibleDescendant: FileSystemHandle): Promise<string[] | null>;
  values(): AsyncIterable<FileSystemHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
}

export interface FileSystemWritableFileStream extends WritableStream {
  write(data: string | BufferSource | Blob): Promise<void>;
  seek(position: number): Promise<void>;
  truncate(size: number): Promise<void>;
}

export interface EditorFile {
  id: string;
  name: string;
  path?: string; // Relative path from root, e.g., "docs/readme.md"
  handle?: FileSystemFileHandle;
  content: string;
  isDirty: boolean;
  lastModified: number;
  cursorPosition?: { lineNumber: number; column: number };
}

export interface AppState {
  files: EditorFile[];
  activeFileId: string | null;
  sidebarVisible: boolean;
  viewMode: 'editor' | 'split' | 'preview' | 'wysiwyg';
  theme: 'dark' | 'light';
  rootDirHandle?: FileSystemDirectoryHandle; // Added for folder support
}
