
import React, { useRef, useEffect, useCallback } from 'react';
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
  
  // Track image DOM nodes for selection highlighting
  const imageWidgets = useRef<{ lineNumber: number, wrapper: HTMLElement }[]>([]);

  // Track the currently dragged image info for 'Move' operations
  const activeDragImageRef = useRef<{ range: any, text: string } | null>(null);
  
  useEffect(() => {
    onPasteImageRef.current = onPasteImage;
  }, [onPasteImage]);

  const updateImageSelection = (editor: any) => {
      if (!editor) return;
      const selections = editor.getSelections() || [];
      
      imageWidgets.current.forEach(widget => {
            let isSelected = false;
            for (const sel of selections) {
                if (!sel.isEmpty()) {
                    if (sel.startLineNumber <= widget.lineNumber && sel.endLineNumber >= widget.lineNumber) {
                        isSelected = true;
                        break;
                    }
                }
            }
            if (isSelected) {
                widget.wrapper.classList.add('selected');
            } else {
                widget.wrapper.classList.remove('selected');
            }
      });
  };

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
      scrollBeyondLastLine: true,
      glyphMargin: false,
    });

    if (initialCursorPosition) {
        editor.setPosition(initialCursorPosition);
        editor.revealPositionInCenter(initialCursorPosition);
    }

    editor.onDidChangeCursorPosition((e) => {
        if (onCursorChange) {
            onCursorChange(e.position.lineNumber, e.position.column);
        }
    });

    editor.onDidChangeCursorSelection((e) => {
        updateImageSelection(editor);
    });

    // Automatically hide image source code whenever content changes
    editor.onDidChangeModelContent(() => {
        requestAnimationFrame(() => updateImageDecorations(editor));
    });

    // Drag and Drop Handler for Moving Images
    const domNode = editor.getDomNode();
    if (domNode) {
        domNode.addEventListener('dragover', (e: DragEvent) => {
            // Allow drop if we are dragging our own image
            if (activeDragImageRef.current) {
                e.preventDefault();
                e.dataTransfer!.dropEffect = 'move';
            }
        });

        domNode.addEventListener('drop', (e: DragEvent) => {
            if (activeDragImageRef.current) {
                e.preventDefault(); // Stop default text insertion
                
                const target = editor.getTargetAtClientPoint(e.clientX, e.clientY);
                if (target && target.position) {
                    const { range, text } = activeDragImageRef.current;
                    
                    // Prevent dropping onto itself (overlapping range)
                    if (range.containsPosition(target.position)) {
                         activeDragImageRef.current = null;
                         return;
                    }
                    
                    // Perform Move: Delete Source + Insert Target
                    editor.executeEdits('image-drag-move', [
                        { range: range, text: "", forceMoveMarkers: true },
                        { 
                          range: { 
                            startLineNumber: target.position.lineNumber, 
                            startColumn: target.position.column, 
                            endLineNumber: target.position.lineNumber, 
                            endColumn: target.position.column 
                          }, 
                          text: text, 
                          forceMoveMarkers: true 
                        }
                    ]);
                    
                    editor.focus();
                    editor.setPosition(target.position);
                    activeDragImageRef.current = null;
                    
                    // Trigger immediate rescan to render the image at new location
                    setTimeout(() => scanAndRenderImages(editor), 10);
                }
            }
        });
    }

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

  const loadImageBlob = async (src: string): Promise<string | null> => {
      let cleanSrc = src.trim();
      const firstSpace = cleanSrc.indexOf(' ');
      if (firstSpace > 0) {
          cleanSrc = cleanSrc.substring(0, firstSpace);
      }
      cleanSrc = cleanSrc.replace(/['"]/g, '');

      if (cleanSrc.startsWith('http') || cleanSrc.startsWith('data:')) return cleanSrc;
      if (!rootDirHandle) return null;
      
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

     const regex = /!\[(.*?)\]\((.*?)\)/g;
     
     const matches: any[] = [];
     const lines = model.getLineCount();

     for (let i = 1; i <= lines; i++) {
         const lineContent = model.getLineContent(i);
         let match;
         while ((match = regex.exec(lineContent)) !== null) {
             const startCol = match.index + 1;
             const endCol = startCol + match[0].length;
             
             // Always hide the source code, regardless of cursor position
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
      // Regex to capture markdown images: ![alt](src)
      const regex = /!\[(.*?)\]\((.*?)\)/g;
      
      // Store object wrapper { zone, ref } where ref will be populated with ID later
      const newViewZones: { zone: any, ref: { id: string | null } }[] = [];
      const imageRequests: { lineNumber: number, src: string, alt: string, isFirstOnPureLine: boolean }[] = [];
      const newImageWidgets: { lineNumber: number, wrapper: HTMLElement }[] = [];

      for (let i = 1; i <= lines; i++) {
          const lineContent = model.getLineContent(i);
          const lineMatches: any[] = [];
          let match;
          
          // Reset regex
          regex.lastIndex = 0;
          while ((match = regex.exec(lineContent)) !== null) {
              lineMatches.push(match);
          }
          
          if (lineMatches.length === 0) continue;

          // Check if line contains ONLY images (ignoring whitespace)
          // This allows us to collapse the line height for pure image lines
          let remainingText = lineContent;
          lineMatches.forEach(m => { remainingText = remainingText.replace(m[0], ''); });
          const isPureLine = remainingText.trim() === '';

          lineMatches.forEach((m, index) => {
              imageRequests.push({ 
                lineNumber: i, 
                src: m[2], 
                alt: m[1],
                // If it's a pure image line, the first image absorbs the line height
                isFirstOnPureLine: isPureLine && (index === 0)
              });
          });
      }

      await Promise.all(imageRequests.map(async (req) => {
          const url = await loadImageBlob(req.src);
          if (url) {
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
                  // Apply theme-based background to mask the underlying line if we pull it up
                  container.classList.add('bg-white', 'dark:bg-[#1e1e1e]');

                  // Main Wrapper - Focusable for Selection
                  const wrapper = document.createElement('div');
                  wrapper.className = 'monaco-image-wrapper';
                  wrapper.tabIndex = 0; // Make focusable
                  wrapper.draggable = true; // Enable Drag
                  
                  newImageWidgets.push({ lineNumber: req.lineNumber, wrapper });

                  // Ref to store zone ID later, used in resize handler
                  const zoneRef = { id: null as string | null };
                  
                  // ViewZone Configuration
                  const viewZone: any = {
                      afterLineNumber: req.lineNumber,
                      heightInLines: 0, // Calculated on load
                      domNode: container,
                      suppressMouseDown: false 
                  };

                  // Helper to find current range in case of edits
                  const getLatestRangeAndText = () => {
                      const currentModel = editor.getModel();
                      if (!currentModel) return null;
                      
                      try {
                          const lineContent = currentModel.getLineContent(req.lineNumber);
                          const regex = /!\[(.*?)\]\((.*?)\)/g;
                          let m;
                          while ((m = regex.exec(lineContent)) !== null) {
                              if (m[2] === req.src) {
                                  const start = m.index + 1;
                                  return {
                                      text: m[0],
                                      range: new monacoRef.current!.Range(req.lineNumber, start, req.lineNumber, start + m[0].length)
                                  };
                              }
                          }
                      } catch (e) { /* Line might have been deleted */ }
                      return null;
                  };

                  // --- Drag and Drop Handling (Source) ---
                  wrapper.addEventListener('dragstart', (e) => {
                      const info = getLatestRangeAndText();
                      if (info) {
                          // Set the correct markdown text instead of the image URL
                          e.dataTransfer?.setData('text/plain', info.text);
                          e.dataTransfer!.effectAllowed = 'copyMove';
                          
                          // Track this drag internally to support "Move" operation (delete original)
                          activeDragImageRef.current = { range: info.range, text: info.text };

                          // Set custom drag image if possible (the img element)
                          const imgEl = wrapper.querySelector('img');
                          if (imgEl && e.dataTransfer?.setDragImage) {
                              e.dataTransfer.setDragImage(imgEl, 0, 0);
                          }
                      }
                  });

                  wrapper.addEventListener('dragend', () => {
                      // Clear the drag ref after a short delay to allow the drop handler to execute first
                      setTimeout(() => { activeDragImageRef.current = null; }, 100);
                  });

                  // --- Keyboard Handling (Copy/Cut/Delete/Nav) ---
                  wrapper.onkeydown = (e) => {
                      if (document.activeElement !== wrapper) return;

                      const isCmd = e.ctrlKey || e.metaKey;
                      const key = e.key.toLowerCase();

                      if (key === 'arrowdown') {
                          e.preventDefault();
                          editor.focus();
                          const nextLine = Math.min(model.getLineCount(), req.lineNumber + 1);
                          editor.setPosition({ lineNumber: nextLine, column: 1 });
                      }
                      if (key === 'arrowup') {
                          e.preventDefault();
                          editor.focus();
                          const prevLine = Math.max(1, req.lineNumber - 1);
                          editor.setPosition({ lineNumber: prevLine, column: 1 });
                      }
                      
                      if (key === 'escape') {
                          e.preventDefault();
                          editor.focus();
                      }

                      if (e.key === 'Delete' || e.key === 'Backspace') {
                          e.preventDefault();
                          e.stopPropagation();
                          const info = getLatestRangeAndText();
                          if (info) {
                              editor.executeEdits('image-delete', [{ range: info.range, text: "", forceMoveMarkers: true }]);
                              editor.focus(); 
                          }
                      }

                      if (isCmd && key === 'c') {
                          e.preventDefault();
                          e.stopPropagation();
                          const info = getLatestRangeAndText();
                          if (info) {
                              navigator.clipboard.writeText(info.text);
                          }
                      }

                      if (isCmd && key === 'x') {
                          e.preventDefault();
                          e.stopPropagation();
                          const info = getLatestRangeAndText();
                          if (info) {
                              navigator.clipboard.writeText(info.text);
                              editor.executeEdits('image-cut', [{ range: info.range, text: "", forceMoveMarkers: true }]);
                              editor.focus();
                          }
                      }
                  };

                  wrapper.onfocus = () => {
                      requestAnimationFrame(() => updateImageDecorations(editor));
                  };
                  
                  // Prevent default selection when clicking on image wrapper
                  wrapper.onmousedown = (e) => {
                      e.stopPropagation(); 
                  };
                  
                  // Custom Click handler to place cursor when clicking outside the image in the widget area
                  container.onmousedown = (e) => {
                      // Skip if resizing is active (handled by dataset flag)
                      if (container.dataset.resizing === "true") return;
                      // Skip if we clicked the image itself or its handle
                      if (e.target !== container) return;
                      
                      e.preventDefault();
                      
                      const rect = wrapper.getBoundingClientRect();
                      
                      if (e.clientX > rect.right) {
                          // Clicked to the right: move to start of next line
                          const nextLine = req.lineNumber + 1;
                          if (nextLine <= model.getLineCount()) {
                              editor.setPosition({ lineNumber: nextLine, column: 1 });
                          } else {
                              // If last line, append newline
                              const endCol = model.getLineMaxColumn(req.lineNumber);
                              editor.executeEdits('append-newline', [{
                                  range: new monacoRef.current!.Range(req.lineNumber, endCol, req.lineNumber, endCol),
                                  text: '\n',
                                  forceMoveMarkers: true
                              }]);
                              editor.setPosition({ lineNumber: nextLine, column: 1 });
                          }
                      } else {
                          // Clicked to the left -> Go to start of current line
                          editor.setPosition({ lineNumber: req.lineNumber, column: 1 });
                      }
                      editor.focus();
                  };

                  const img = document.createElement('img');
                  img.src = url;
                  img.className = 'monaco-image-element';
                  if (widthVal) {
                      img.style.width = `${widthVal}px`;
                  } else {
                      img.style.width = 'auto'; 
                      img.style.maxWidth = '100%'; 
                  }
                  
                  const handle = document.createElement('div');
                  handle.className = 'monaco-image-handle';
                  handle.title = 'Drag to resize';

                  wrapper.appendChild(img);
                  wrapper.appendChild(handle);
                  container.appendChild(wrapper);

                  const handleMouseDown = (e: MouseEvent) => {
                      e.preventDefault();
                      e.stopPropagation(); 
                      wrapper.focus();
                      container.dataset.resizing = "true"; // Mark container as resizing to block cursor clicks

                      const startX = e.clientX;
                      const startWidth = img.offsetWidth;
                      const aspectRatio = img.naturalHeight / img.naturalWidth;
                      
                      // Constants for real-time layout update
                      const lineHeight = editor.getOption(monacoRef.current!.editor.EditorOption.lineHeight) || 19;
                      const PADDING = 12;
                      
                      let animationFrame: number;
                      let lastLayoutTime = 0; // Throttle timestamp

                      const onMouseMove = (moveEvent: MouseEvent) => {
                          if (animationFrame) cancelAnimationFrame(animationFrame);
                          
                          animationFrame = requestAnimationFrame(() => {
                              const diff = moveEvent.clientX - startX;
                              const currentW = Math.max(50, startWidth + diff);
                              
                              // Update visual width immediately (60fps)
                              img.style.width = `${currentW}px`;
                              
                              // Real-time Layout Update (Throttled)
                              if (zoneRef.id) {
                                  const now = Date.now();
                                  // Throttle layout triggers to approx 30fps (32ms) to avoid heavy Monaco layout thrashing
                                  if (now - lastLayoutTime > 32) {
                                      const renderedHeight = (img.naturalHeight / img.naturalWidth) * currentW;
                                      
                                      let heightDeduction = 0;
                                      // If it's a pure image line, we are pulling it up by one lineHeight
                                      if (req.isFirstOnPureLine) {
                                          heightDeduction = lineHeight;
                                      }

                                      const heightInLines = Math.max(0.1, (renderedHeight + PADDING - heightDeduction) / lineHeight);
                                      
                                      // Only update if change is significant (> 0.05 lines) to reduce jitter
                                      if (Math.abs(viewZone.heightInLines - heightInLines) > 0.05) {
                                          viewZone.heightInLines = heightInLines;
                                          editor.changeViewZones((accessor: any) => {
                                              accessor.layoutZone(zoneRef.id);
                                          });
                                          lastLayoutTime = now;
                                      }
                                  }
                              }
                          });
                      };

                      const onMouseUp = (upEvent: MouseEvent) => {
                          document.removeEventListener('mousemove', onMouseMove);
                          document.removeEventListener('mouseup', onMouseUp);
                          if (animationFrame) cancelAnimationFrame(animationFrame);
                          
                          setTimeout(() => { delete container.dataset.resizing; }, 50);

                          const diff = upEvent.clientX - startX;
                          const finalWidth = Math.max(50, startWidth + diff);
                          const info = getLatestRangeAndText();
                          if (info) {
                              const newAlt = `${cleanAlt}|${Math.round(finalWidth)}`;
                              const newText = `![${newAlt}](${req.src})`;
                              editor.executeEdits('image-resize', [{
                                  range: info.range,
                                  text: newText,
                                  forceMoveMarkers: true
                              }]);
                              
                              // Force a final layout update to be perfectly precise
                              if (zoneRef.id) {
                                  const renderedHeight = (img.naturalHeight / img.naturalWidth) * finalWidth;
                                  let heightDeduction = req.isFirstOnPureLine ? lineHeight : 0;
                                  viewZone.heightInLines = Math.max(0.1, (renderedHeight + PADDING - heightDeduction) / lineHeight);
                                  editor.changeViewZones((accessor: any) => {
                                      accessor.layoutZone(zoneRef.id);
                                  });
                              }
                          }
                      };
                      document.addEventListener('mousemove', onMouseMove);
                      document.addEventListener('mouseup', onMouseUp);
                  };
                  
                  handle.onmousedown = handleMouseDown as any;

                  img.onload = () => {
                      const lineHeight = editor.getOption(monacoRef.current!.editor.EditorOption.lineHeight) || 19;
                      
                      let renderedHeight = img.naturalHeight;
                      if (widthVal) {
                          renderedHeight = (img.naturalHeight / img.naturalWidth) * widthVal;
                      } else {
                          const MAX_AUTO_WIDTH = 800; 
                          if (img.naturalWidth > MAX_AUTO_WIDTH) {
                               renderedHeight = (img.naturalHeight / img.naturalWidth) * MAX_AUTO_WIDTH;
                          }
                      }
                      renderedHeight = Math.max(20, renderedHeight);
                      const PADDING = 12;

                      // Logic to hide the underlying line if it's a "Pure Image Line"
                      let marginTop = 0;
                      let heightDeduction = 0;
                      
                      if (req.isFirstOnPureLine) {
                          // Pull the image up by one line height to cover the empty text line
                          marginTop = -lineHeight;
                          // Reduce the reserved space because we are consuming the line's space
                          heightDeduction = lineHeight;
                          container.style.marginTop = `${marginTop}px`;
                      }

                      // Calculate required height in lines, accounting for the deduction
                      const heightInLines = Math.max(0.1, (renderedHeight + PADDING - heightDeduction) / lineHeight);

                      viewZone.heightInLines = heightInLines;
                      
                      newViewZones.push({ zone: viewZone, ref: zoneRef });
                      resolve();
                  };
                  
                  img.onerror = () => resolve();
              });
          }
      }));

      editor.changeViewZones((changeAccessor: any) => {
          viewZoneIds.current.forEach((id) => changeAccessor.removeZone(id));
          viewZoneIds.current = [];

          newViewZones.forEach(item => {
              // Add zone and store the ID in the shared ref object for the event handler
              const id = changeAccessor.addZone(item.zone);
              item.ref.id = id;
              viewZoneIds.current.push(id);
          });
      });

      imageWidgets.current = newImageWidgets;
      updateImageSelection(editor);
      
      updateImageDecorations(editor);
  };

  useEffect(() => {
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
                color: transparent !important;
                font-size: 0px !important;
                letter-spacing: -1px !important;
                display: none !important;
            }
            .monaco-image-widget {
                display: block;
                margin: 6px 0;
                z-index: 10;
                user-select: none;
                /* Background is handled by utility classes in TSX for theme support */
            }
            .monaco-image-wrapper {
                position: relative;
                display: inline-block;
                line-height: 0;
                transition: border-color 0.1s, box-shadow 0.1s; /* Optimized transition for performance */
                border-radius: 4px;
                outline: none; 
                cursor: default;
                border: 2px solid transparent; 
            }
            .monaco-image-wrapper.selected {
                box-shadow: 0 0 0 2px #3b82f6;
            }
            .monaco-image-wrapper.selected::after {
                content: "";
                position: absolute;
                top: 0; left: 0; right: 0; bottom: 0;
                background-color: rgba(59, 130, 246, 0.2);
                pointer-events: none;
                border-radius: 4px;
            }
            .monaco-image-element {
                display: block;
                border-radius: 4px;
                cursor: pointer;
            }
            .monaco-image-wrapper:focus {
                border-color: #3b82f6; 
                box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
            }
            .monaco-image-handle {
                position: absolute;
                bottom: 6px;
                right: 6px;
                width: 12px;
                height: 12px;
                background-color: #3b82f6;
                border: 2px solid white;
                border-radius: 50%;
                cursor: nwse-resize;
                opacity: 0;
                transition: opacity 0.2s, transform 0.1s;
                z-index: 20;
                pointer-events: auto;
                box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            }
            .monaco-image-wrapper:hover .monaco-image-handle,
            .monaco-image-wrapper:focus .monaco-image-handle {
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
          scrollBeyondLastLine: true,
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
