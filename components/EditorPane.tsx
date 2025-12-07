

import React, { useRef, useEffect, useCallback, useState } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { FileSystemFileHandle, FileSystemDirectoryHandle } from '../types';

interface EditorPaneProps {
  fileId: string;
  content: string;
  language?: string;
  initialCursorPosition?: { lineNumber: number; column: number };
  theme?: 'dark' | 'light';
  onChange: (value: string) => void;
  onCursorChange?: (lineNumber: number, column: number) => void;
  onSave: () => void;
  onPasteImage?: (blob: Blob) => Promise<string | null>;
  onFileLinkClick?: (target: string) => void;
  scrollToAnchor?: string | null;
  rootDirHandle?: FileSystemDirectoryHandle;
  filePath?: string;
}

// Helper to resolve paths (duplicated to avoid external dependency complexity in this refactor)
const resolvePath = (basePath: string, relativePath: string): string => {
  if (!basePath || relativePath.startsWith('/') || relativePath.startsWith('http') || relativePath.startsWith('data:')) {
      return relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
  }
  const stack = basePath.split('/');
  stack.pop(); 
  const parts = relativePath.split('/');
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      if (stack.length > 0) stack.pop();
    } else {
      stack.push(part);
    }
  }
  return stack.join('/');
};

const EditorPane: React.FC<EditorPaneProps> = ({ 
  fileId, 
  content, 
  language = 'markdown', 
  initialCursorPosition,
  theme = 'dark',
  onChange,
  onCursorChange,
  onSave,
  onPasteImage,
  onFileLinkClick,
  scrollToAnchor,
  rootDirHandle,
  filePath
}) => {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const onPasteImageRef = useRef(onPasteImage);
  
  // Ref for tracking ViewZones and Decorations to avoid race conditions or stale closures
  const viewZonesMap = useRef<Map<number, string>>(new Map()); // lineNumber -> viewZoneId
  const decorationsMap = useRef<string[]>([]);
  const imageCache = useRef<Map<string, string>>(new Map()); // src -> blobUrl

  // Keep the ref updated with the latest callback
  useEffect(() => {
    onPasteImageRef.current = onPasteImage;
  }, [onPasteImage]);

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    editor.updateOptions({
      wordWrap: 'on',
      minimap: { enabled: true },
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      padding: { top: 16 },
      fontFamily: "'Fira Code', 'Droid Sans Mono', 'monospace', monospace",
      fontSize: 14,
    });

    // Restore cursor position if available
    if (initialCursorPosition) {
        editor.setPosition(initialCursorPosition);
        editor.revealPositionInCenter(initialCursorPosition);
    }

    // Track cursor changes for both position prop and Image Hiding logic
    editor.onDidChangeCursorPosition((e) => {
        if (onCursorChange) {
            onCursorChange(e.position.lineNumber, e.position.column);
        }
        updateImageDecorations(editor);
    });

    // Handle Link Click (Ctrl+Click or Double Click)
    editor.onMouseDown((e) => {
      if (!onFileLinkClick) return;

      const isCtrlCmd = e.event.ctrlKey || e.event.metaKey;
      const isDoubleClick = e.event.browserEvent.detail === 2;

      if ((isCtrlCmd || isDoubleClick) && e.target.type === monaco.editor.MouseTargetType.CONTENT_TEXT && e.target.position) {
          const model = editor.getModel();
          if (!model) return;
          
          const position = e.target.position;
          const lineContent = model.getLineContent(position.lineNumber);
          
          const regex = /\[\[([^\]|]+)(\|([^\]]+))?\]\]/g;
          let match;
          
          while ((match = regex.exec(lineContent)) !== null) {
              const startCol = match.index + 1;
              const endCol = startCol + match[0].length;
              
              if (position.column >= startCol && position.column <= endCol) {
                  const target = match[1];
                  setTimeout(() => onFileLinkClick(target), 0);
                  return;
              }
          }
      }
    });

    // Initialize Image Preview
    scanAndRenderImages(editor);
  };

  // --- Image Preview Logic (Inline Images in Monaco) ---

  // Load image blob from FS
  const loadImageBlob = async (src: string): Promise<string | null> => {
      if (src.startsWith('http') || src.startsWith('data:')) return src;
      if (!rootDirHandle) return null;
      if (imageCache.current.has(src)) return imageCache.current.get(src)!;

      try {
           const resolvedPath = resolvePath(filePath || '', src);
           const parts = resolvedPath.split('/');
           const fileName = parts.pop();
           if (!fileName) return null;

           let currentDir = rootDirHandle;
           for (const part of parts) {
               currentDir = await currentDir.getDirectoryHandle(part);
           }
           const fileHandle = await currentDir.getFileHandle(fileName);
           const file = await fileHandle.getFile();
           const url = URL.createObjectURL(file);
           imageCache.current.set(src, url);
           return url;
      } catch (e) {
          // console.warn('Failed to load local image in editor', src);
          return null;
      }
  };

  const updateImageDecorations = (editor: any) => {
     if (!editor) return;
     const model = editor.getModel();
     if (!model) return;
     const cursorLine = editor.getPosition()?.lineNumber;

     // Regex for images: ![alt](src) matching full line or part
     const matches: any[] = [];
     const lines = model.getLineCount();
     const regex = /!\[.*?\]\(.*?\)/g;

     for (let i = 1; i <= lines; i++) {
         const lineContent = model.getLineContent(i);
         let match;
         while ((match = regex.exec(lineContent)) !== null) {
             // If cursor is on this line, DO NOT hide.
             if (i === cursorLine) continue;

             const startCol = match.index + 1;
             const endCol = startCol + match[0].length;
             
             matches.push({
                 range: new (monacoRef.current!.Range)(i, startCol, i, endCol),
                 options: {
                     inlineClassName: 'hidden-image-code', // CSS class to make transparent/tiny
                     description: 'hide-image-source'
                 }
             });
         }
     }
     
     // Update decorations (replace old ones)
     decorationsMap.current = editor.deltaDecorations(decorationsMap.current, matches);
  };

  const scanAndRenderImages = async (editor: any) => {
      const model = editor.getModel();
      if (!model) return;

      const lines = model.getLineCount();
      const regex = /!\[.*?\]\((.*?)\)/g;
      
      const newViewZones: any[] = [];
      const imageLines = new Set<number>();
      
      // Collect requests first to process them
      const imageRequests: { lineNumber: number, src: string }[] = [];

      for (let i = 1; i <= lines; i++) {
          const lineContent = model.getLineContent(i);
          let match;
          while ((match = regex.exec(lineContent)) !== null) {
              const src = match[1];
              // Avoid multiple view zones on the same line for now
              if (!imageLines.has(i)) {
                  imageLines.add(i);
                  imageRequests.push({ lineNumber: i, src });
              }
              break; 
          }
      }

      // Process images concurrently
      await Promise.all(imageRequests.map(async (req) => {
          const url = await loadImageBlob(req.src);
          if (url) {
              return new Promise<void>((resolve) => {
                  const img = document.createElement('img');
                  img.src = url;
                  img.style.maxWidth = '100%';
                  img.style.borderRadius = '4px';
                  img.style.display = 'block';
                  img.style.marginTop = '4px';
                  img.style.marginBottom = '4px';
                  
                  // Wait for load to get dimensions for ViewZone height
                  img.onload = () => {
                      // Monaco needs height in lines.
                      // Get current editor line height
                      const lineHeight = editor.getOption(monacoRef.current!.editor.EditorOption.lineHeight) || 19;
                      
                      // Calculate required lines: (Image Height + Margins) / LineHeight
                      const totalHeight = img.naturalHeight + 8; // +8 for margins
                      const heightInLines = Math.ceil(totalHeight / lineHeight);

                      const domNode = document.createElement('div');
                      domNode.appendChild(img);

                      newViewZones.push({
                          afterLineNumber: req.lineNumber,
                          heightInLines: heightInLines, // Exact height!
                          domNode: domNode,
                          suppressMouseDown: true // Allow editing around it
                      });
                      resolve();
                  };
                  
                  // Handle error or timeout
                  img.onerror = () => resolve();
              });
          }
      }));

      // Apply changes to ViewZones
      editor.changeViewZones((changeAccessor: any) => {
          viewZonesMap.current.forEach((id) => changeAccessor.removeZone(id));
          viewZonesMap.current.clear();

          newViewZones.forEach(zone => {
              const id = changeAccessor.addZone(zone);
              viewZonesMap.current.set(zone.afterLineNumber, id);
          });
      });
      
      // Update hiding decorations
      updateImageDecorations(editor);
  };

  // Re-scan images when content changes (debounced)
  useEffect(() => {
      const timer = setTimeout(() => {
          if (editorRef.current) {
              scanAndRenderImages(editorRef.current);
          }
      }, 500); // 500ms debounce
      return () => clearTimeout(timer);
  }, [content, rootDirHandle, filePath]);

  // Inject CSS for hiding image code
  useEffect(() => {
      const styleId = 'monaco-image-hide-styles';
      if (!document.getElementById(styleId)) {
          const style = document.createElement('style');
          style.id = styleId;
          style.innerHTML = `
            .hidden-image-code {
                color: transparent !important;
                font-size: 1px !important;
                letter-spacing: -1px;
                opacity: 0;
            }
          `;
          document.head.appendChild(style);
      }
  }, []);


  const handlePasteCapture = useCallback(async (e: React.ClipboardEvent) => {
      if (!onPasteImageRef.current) return;
      
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
          if (items[i].type.indexOf('image') !== -1) {
              e.preventDefault();
              e.stopPropagation();
              
              const blob = items[i].getAsFile();
              const editor = editorRef.current;
              
              if (blob && editor) {
                   const currentPos = editor.getPosition();
                   if (!currentPos) return;

                   const placeholder = "![Uploading image...]()";
                   const monaco = (window as any).monaco;
                   if (!monaco) return;

                   const range = new monaco.Range(currentPos.lineNumber, currentPos.column, currentPos.lineNumber, currentPos.column);
                   
                   editor.executeEdits('paste-image', [{
                       range: range,
                       text: placeholder,
                       forceMoveMarkers: true
                   }]);

                   try {
                       const fileName = await onPasteImageRef.current(blob);
                       
                       if (fileName) {
                           const model = editor.getModel();
                           if (model) {
                               const endColumn = currentPos.column + placeholder.length;
                               const placeholderRange = new monaco.Range(currentPos.lineNumber, currentPos.column, currentPos.lineNumber, endColumn);
                               
                               const currentTextInRange = model.getValueInRange(placeholderRange);
                               
                               if (currentTextInRange === placeholder) {
                                    editor.executeEdits('paste-image-replace', [{
                                        range: placeholderRange,
                                        text: `![Image](${fileName})`,
                                        forceMoveMarkers: true
                                    }]);
                               } else {
                                   const newPos = editor.getPosition();
                                   editor.executeEdits('paste-image-append', [{
                                        range: new monaco.Range(newPos.lineNumber, newPos.column, newPos.lineNumber, newPos.column),
                                        text: `![Image](${fileName})`,
                                        forceMoveMarkers: true
                                    }]);
                               }
                           }
                           // Trigger immediate re-scan
                           setTimeout(() => scanAndRenderImages(editor), 100);
                       } else {
                           const endColumn = currentPos.column + placeholder.length;
                           const placeholderRange = new monaco.Range(currentPos.lineNumber, currentPos.column, currentPos.lineNumber, endColumn);
                           editor.executeEdits('paste-image-undo', [{
                                range: placeholderRange,
                                text: "",
                                forceMoveMarkers: true
                            }]);
                       }
                   } catch (err) {
                       console.error("Paste failed", err);
                   }
              }
              return; 
          }
      }
  }, []);

  // Handle Scroll to Anchor
  useEffect(() => {
      if (editorRef.current && scrollToAnchor) {
          const editor = editorRef.current;
          const model = editor.getModel();
          if (!model) return;

          const matches = model.findMatches(`^#+\\s+.*${scrollToAnchor.replace(/-/g, ' ')}`, false, true, false, null, true);
          
          if (matches && matches.length > 0) {
              const match = matches[0];
              editor.revealLineInCenter(match.range.startLineNumber);
              editor.setPosition({ lineNumber: match.range.startLineNumber, column: 1 });
              editor.focus();
          }
      }
  }, [scrollToAnchor, fileId]);

  return (
    <div className="h-full w-full overflow-hidden bg-white dark:bg-[#1e1e1e]" onPasteCapture={handlePasteCapture}>
      <Editor
        height="100%"
        theme={theme === 'dark' ? 'vs-dark' : 'light'}
        path={fileId} // Important for Monaco model caching per file
        defaultLanguage={language}
        defaultValue={content} // Only used for initial load of a new model
        onChange={(value) => onChange(value || '')}
        onMount={handleEditorDidMount}
        options={{
          selectOnLineNumbers: true,
          automaticLayout: true,
          renderWhitespace: 'selection',
          scrollBeyondLastLine: true,
        }}
      />
    </div>
  );
};

export default EditorPane;