
import React, { useRef, useEffect, useCallback, useState } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { FileSystemDirectoryHandle } from '../types';

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

// Helper to resolve paths
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
  
  // Track ViewZone IDs to clean up properly
  const viewZoneIds = useRef<string[]>([]);
  const decorationsMap = useRef<string[]>([]);
  const imageCache = useRef<Map<string, string>>(new Map()); // src -> blobUrl

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
      scrollBeyondLastLine: false,
      glyphMargin: false, // Cleaner look for image widgets
    });

    if (initialCursorPosition) {
        editor.setPosition(initialCursorPosition);
        editor.revealPositionInCenter(initialCursorPosition);
    }

    editor.onDidChangeCursorPosition((e) => {
        if (onCursorChange) {
            onCursorChange(e.position.lineNumber, e.position.column);
        }
        // Debounce decoration updates slightly to avoid flashing during fast typing
        requestAnimationFrame(() => updateImageDecorations(editor));
    });

    // Link Click Support
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

  const loadImageBlob = async (src: string): Promise<string | null> => {
      // Basic cleanup for src in case it has quotes or title
      // e.g. "image.png" or image.png "title"
      let cleanSrc = src.trim();
      const firstSpace = cleanSrc.indexOf(' ');
      if (firstSpace > 0) {
          cleanSrc = cleanSrc.substring(0, firstSpace);
      }
      cleanSrc = cleanSrc.replace(/['"]/g, '');

      if (cleanSrc.startsWith('http') || cleanSrc.startsWith('data:')) return cleanSrc;
      if (!rootDirHandle) return null;
      
      // Cache check
      if (imageCache.current.has(cleanSrc)) return imageCache.current.get(cleanSrc)!;

      try {
           const resolvedPath = resolvePath(filePath || '', cleanSrc);
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
           imageCache.current.set(cleanSrc, url);
           return url;
      } catch (e) {
          return null;
      }
  };

  const updateImageDecorations = (editor: any) => {
     if (!editor) return;
     const model = editor.getModel();
     if (!model) return;
     const cursorLine = editor.getPosition()?.lineNumber;

     // Match ![alt](src)
     const regex = /!\[(.*?)\]\((.*?)\)/g;
     
     const matches: any[] = [];
     const lines = model.getLineCount();

     for (let i = 1; i <= lines; i++) {
         // If cursor is on this line, DO NOT hide the markdown code.
         if (i === cursorLine) continue;

         const lineContent = model.getLineContent(i);
         let match;
         while ((match = regex.exec(lineContent)) !== null) {
             const startCol = match.index + 1;
             const endCol = startCol + match[0].length;
             
             matches.push({
                 range: new (monacoRef.current!.Range)(i, startCol, i, endCol),
                 options: {
                     inlineClassName: 'hidden-image-code', 
                     description: 'hide-image-source'
                 }
             });
         }
     }
     
     decorationsMap.current = editor.deltaDecorations(decorationsMap.current, matches);
  };

  const scanAndRenderImages = async (editor: any) => {
      const model = editor.getModel();
      if (!model || !monacoRef.current) return;

      const lines = model.getLineCount();
      const regex = /!\[(.*?)\]\((.*?)\)/g;
      
      const newViewZones: any[] = [];
      const imageRequests: { lineNumber: number, src: string, alt: string, range: any }[] = [];

      // First pass: scan all lines
      for (let i = 1; i <= lines; i++) {
          const lineContent = model.getLineContent(i);
          let match;
          while ((match = regex.exec(lineContent)) !== null) {
              const alt = match[1];
              const src = match[2];
              const matchStart = match.index + 1;
              const matchEnd = matchStart + match[0].length;

              imageRequests.push({ 
                lineNumber: i, 
                src, 
                alt,
                range: new monacoRef.current!.Range(i, matchStart, i, matchEnd) 
              });
          }
      }

      // Second pass: Load images and prepare ViewZones
      await Promise.all(imageRequests.map(async (req) => {
          const url = await loadImageBlob(req.src);
          if (url) {
              // Parse width from alt:  "my-image|200" or "my-image|200x100"
              let widthVal: number | null = null;
              let cleanAlt = req.alt;
              const parts = req.alt.split('|');
              
              if (parts.length > 1) {
                   const last = parts[parts.length - 1];
                   const match = last.match(/^(\d+)(x\d+)?$/);
                   if (match) {
                       widthVal = parseInt(match[1]);
                       cleanAlt = parts.slice(0, -1).join('|');
                   }
              }

              return new Promise<void>((resolve) => {
                  const container = document.createElement('div');
                  container.className = 'monaco-image-widget';
                  
                  // Wrapper to handle hover and positioning
                  const wrapper = document.createElement('div');
                  wrapper.className = 'monaco-image-wrapper';
                  
                  const img = document.createElement('img');
                  img.src = url;
                  img.className = 'monaco-image-element';
                  if (widthVal) {
                      img.style.width = `${widthVal}px`;
                  } else {
                      img.style.width = 'auto'; // Default 
                      img.style.maxWidth = '100%'; 
                  }
                  
                  // Resize Handle
                  const handle = document.createElement('div');
                  handle.className = 'monaco-image-handle';
                  handle.title = 'Drag to resize';

                  wrapper.appendChild(img);
                  wrapper.appendChild(handle);
                  container.appendChild(wrapper);

                  // --- Resize Logic ---
                  const handleMouseDown = (e: MouseEvent) => {
                      e.preventDefault();
                      e.stopPropagation(); // Stop Monaco from stealing the event
                      
                      const startX = e.clientX;
                      const startWidth = img.offsetWidth;
                      
                      const onMouseMove = (moveEvent: MouseEvent) => {
                          const diff = moveEvent.clientX - startX;
                          const currentW = Math.max(50, startWidth + diff);
                          img.style.width = `${currentW}px`;
                      };

                      const onMouseUp = (upEvent: MouseEvent) => {
                          document.removeEventListener('mousemove', onMouseMove);
                          document.removeEventListener('mouseup', onMouseUp);
                          
                          const diff = upEvent.clientX - startX;
                          const finalWidth = Math.max(50, startWidth + diff);
                          
                          // We need to fetch the LATEST model content because it might have changed
                          const currentModel = editor.getModel();
                          if (currentModel) {
                              const lineContent = currentModel.getLineContent(req.lineNumber);
                              const lineRegex = /!\[(.*?)\]\((.*?)\)/g;
                              let m;
                              let bestMatch = null;
                              let minDistance = Infinity;

                              // Re-find the exact image match in the line (heuristics for multiple images on line)
                              while ((m = lineRegex.exec(lineContent)) !== null) {
                                  const matchStart = m.index + 1;
                                  const dist = Math.abs(matchStart - req.range.startColumn);
                                  
                                  if (m[2] === req.src && dist < minDistance) {
                                      minDistance = dist;
                                      bestMatch = m;
                                  }
                              }

                              if (bestMatch) {
                                  const matchStart = bestMatch.index + 1;
                                  const matchEnd = matchStart + bestMatch[0].length;
                                  const range = new monacoRef.current!.Range(req.lineNumber, matchStart, req.lineNumber, matchEnd);
                                  
                                  // Construct new markdown: ![alt|width](src)
                                  // Note: if cleanAlt is empty (e.g. ![|100](src)), we preserve that pattern
                                  const newAlt = `${cleanAlt}|${Math.round(finalWidth)}`;
                                  const newText = `![${newAlt}](${req.src})`;
                                  
                                  editor.executeEdits('image-resize', [{
                                      range: range,
                                      text: newText,
                                      forceMoveMarkers: true
                                  }]);
                              }
                          }
                      };

                      document.addEventListener('mousemove', onMouseMove);
                      document.addEventListener('mouseup', onMouseUp);
                  };
                  
                  handle.onmousedown = handleMouseDown as any;

                  img.onload = () => {
                      const lineHeight = editor.getOption(monacoRef.current!.editor.EditorOption.lineHeight) || 19;
                      
                      // Calculate height based on Natural Dimensions and target width.
                      // This is critical because `img.offsetHeight` is 0 when the element is detached.
                      let renderedHeight = img.naturalHeight;
                      if (widthVal) {
                          renderedHeight = (img.naturalHeight / img.naturalWidth) * widthVal;
                      } else {
                          // If auto width, we assume it renders at natural width,
                          // but capped by editor width essentially.
                          // Since we can't easily get computed width, we estimate using natural.
                          // A safe clamp to prevent massive viewzones for 4k images.
                          const MAX_AUTO_WIDTH = 800; 
                          if (img.naturalWidth > MAX_AUTO_WIDTH) {
                               renderedHeight = (img.naturalHeight / img.naturalWidth) * MAX_AUTO_WIDTH;
                          }
                      }
                      
                      // Ensure minimal height to prevent collapse
                      renderedHeight = Math.max(20, renderedHeight);

                      // Add some padding (e.g. 10px top/bottom total)
                      const PADDING = 12; 
                      const heightInLines = Math.ceil((renderedHeight + PADDING) / lineHeight);

                      newViewZones.push({
                          afterLineNumber: req.lineNumber,
                          heightInLines: heightInLines, 
                          domNode: container,
                          suppressMouseDown: false 
                      });
                      resolve();
                  };
                  
                  img.onerror = () => resolve();
              });
          }
      }));

      // Apply changes to ViewZones
      editor.changeViewZones((changeAccessor: any) => {
          viewZoneIds.current.forEach((id) => changeAccessor.removeZone(id));
          viewZoneIds.current = [];

          newViewZones.forEach(zone => {
              const id = changeAccessor.addZone(zone);
              viewZoneIds.current.push(id);
          });
      });
      
      updateImageDecorations(editor);
  };

  useEffect(() => {
      // Debounce logic
      const timer = setTimeout(() => {
          if (editorRef.current) {
              scanAndRenderImages(editorRef.current);
          }
      }, 500); 
      return () => clearTimeout(timer);
  }, [content, rootDirHandle, filePath]);

  // Inject CSS Styles
  useEffect(() => {
      const styleId = 'monaco-image-styles';
      if (!document.getElementById(styleId)) {
          const style = document.createElement('style');
          style.id = styleId;
          style.innerHTML = `
            .hidden-image-code {
                display: none !important; 
                opacity: 0;
            }
            .monaco-image-widget {
                display: block;
                margin: 6px 0; /* Vertical margin handled in height calculation */
                z-index: 10;
                user-select: none;
            }
            .monaco-image-wrapper {
                position: relative;
                display: inline-block;
                line-height: 0;
                transition: all 0.2s;
            }
            .monaco-image-element {
                display: block;
                border-radius: 4px;
                cursor: default;
                transition: box-shadow 0.2s;
            }
            .monaco-image-wrapper:hover .monaco-image-element {
                box-shadow: 0 0 0 2px #0e639c; /* VSCode accent color */
            }
            .monaco-image-handle {
                position: absolute;
                bottom: 5px;
                right: 5px;
                width: 10px;
                height: 10px;
                background-color: #0e639c;
                border: 2px solid white;
                border-radius: 50%;
                cursor: nwse-resize;
                opacity: 0;
                transition: opacity 0.2s, transform 0.1s;
                z-index: 20;
                pointer-events: auto;
            }
            .monaco-image-wrapper:hover .monaco-image-handle {
                opacity: 1;
            }
            .monaco-image-handle:hover {
                transform: scale(1.2);
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
        path={fileId}
        defaultLanguage={language}
        defaultValue={content}
        onChange={(value) => onChange(value || '')}
        onMount={handleEditorDidMount}
        options={{
          selectOnLineNumbers: true,
          automaticLayout: true,
          renderWhitespace: 'selection',
          scrollBeyondLastLine: false,
          scrollbar: {
              vertical: 'visible',
              horizontal: 'visible'
          },
          minimap: {
              enabled: true
          }
        }}
      />
    </div>
  );
};

export default EditorPane;
