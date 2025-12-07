
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useEditor, EditorContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import ImageExtension from '@tiptap/extension-image';
import LinkExtension from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from 'tiptap-markdown';
import { Extension } from '@tiptap/core';
import { FileSystemDirectoryHandle } from '../types';
import { Icons } from './Icon';

interface WysiwygEditorProps {
  content: string;
  onChange: (value: string) => void;
  rootDirHandle?: FileSystemDirectoryHandle;
  filePath?: string; // Current file relative path
  onPasteImage?: (blob: Blob) => Promise<string | null>;
}

// Helper to resolve paths (reused concept from MarkdownPreview)
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

// Custom Image Component for TipTap
const LocalImageComponent = (props: any) => {
  const { node, updateAttributes, extension, selected } = props;
  const { src, alt, title, width } = node.attrs;
  const { rootDirHandle, filePath } = extension.options.ctx;
  
  const [imgSrc, setImgSrc] = useState<string | undefined>(undefined);
  const [error, setError] = useState(false);
  
  const [resizing, setResizing] = useState(false);
  const [localWidth, setLocalWidth] = useState<number | string>(width || 'auto');
  const imgRef = useRef<HTMLImageElement>(null);

  // Sync state with props
  useEffect(() => {
    setLocalWidth(width || 'auto');
  }, [width]);

  useEffect(() => {
    let objectUrl: string | null = null;
    let isMounted = true;

    const load = async () => {
      if (!src) return;
      if (src.startsWith('http') || src.startsWith('data:') || src.startsWith('blob:')) {
         if (isMounted) setImgSrc(src);
         return;
      }

      if (rootDirHandle) {
         try {
           const resolvedPath = resolvePath(filePath || '', src);
           const parts = resolvedPath.split('/');
           const fileName = parts.pop();
           let currentDir = rootDirHandle;
           for (const part of parts) {
               currentDir = await currentDir.getDirectoryHandle(part);
           }
           const fileHandle = await currentDir.getFileHandle(fileName!);
           const file = await fileHandle.getFile();
           objectUrl = URL.createObjectURL(file);
           if (isMounted) setImgSrc(objectUrl);
         } catch (e) {
           console.warn("Wysiwyg image load failed", e);
           if (isMounted) setError(true);
         }
      } else {
          setError(true);
      }
    };
    load();
    return () => { isMounted = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [src, rootDirHandle, filePath]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startWidth = imgRef.current?.offsetWidth || 0;
    setResizing(true);

    const onMouseMove = (moveEvent: MouseEvent) => {
      const currentX = moveEvent.clientX;
      const diffX = currentX - startX;
      // Minimum width 50px
      const newWidth = Math.max(50, startWidth + diffX);
      setLocalWidth(newWidth);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      setResizing(false);
      
      if (imgRef.current) {
        updateAttributes({ width: imgRef.current.offsetWidth });
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [updateAttributes]);

  return (
    <NodeViewWrapper className="relative inline-block my-2 leading-none max-w-full select-none group" style={{ width: localWidth === 'auto' ? 'auto' : `${localWidth}px` }}>
      {error ? (
        <span className="inline-flex items-center gap-1 text-red-500 dark:text-red-400 text-xs bg-red-100 dark:bg-red-900/20 px-2 py-1 rounded border border-red-200 dark:border-red-900/50">
           <Icons.FileText size={12} /> Image not found: {src}
        </span>
      ) : imgSrc ? (
        <div className="relative inline-block w-full h-full">
            <img 
                ref={imgRef}
                src={imgSrc} 
                alt={alt} 
                title={title}
                className={`rounded-lg shadow-sm transition-shadow w-full h-auto block 
                    ${selected || resizing ? 'ring-2 ring-blue-500' : 'group-hover:ring-2 group-hover:ring-blue-500'}
                `} 
            />
            {/* Resize Handle - Always rendered but toggled via opacity */}
            <div 
                onMouseDown={handleMouseDown}
                className={`absolute bottom-1 right-1 w-3 h-3 bg-blue-500 border-2 border-white rounded-full cursor-nwse-resize z-20 shadow-md hover:scale-125 transition-transform transition-opacity duration-200
                    ${selected || resizing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
                `}
                title="Resize"
            />
        </div>
      ) : (
        <div className="bg-gray-200 dark:bg-gray-800 rounded animate-pulse h-32 w-full flex items-center justify-center text-gray-500 text-xs">Loading image...</div>
      )}
    </NodeViewWrapper>
  );
};

// Custom Keymap Extension for Tab handling
const TabExtension = Extension.create({
  name: 'tab-handling',
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        // If in a list, try to sink (indent)
        if (this.editor.isActive('listItem')) {
           if (this.editor.commands.sinkListItem('listItem')) {
               return true;
           }
        }
        // Otherwise insert 4 spaces
        this.editor.commands.insertContent('    ');
        return true;
      },
      'Shift-Tab': () => {
        // If in a list, try to lift (outdent)
        if (this.editor.isActive('listItem')) {
           if (this.editor.commands.liftListItem('listItem')) {
               return true;
           }
        }
        return false;
      }
    };
  }
});

const WysiwygEditor: React.FC<WysiwygEditorProps> = ({ content, onChange, rootDirHandle, filePath, onPasteImage }) => {
  
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
         heading: { levels: [1, 2, 3, 4, 5, 6] },
         codeBlock: false, 
      }),
      LinkExtension.configure({
        openOnClick: false,
        HTMLAttributes: {
            class: 'text-blue-600 dark:text-blue-400 hover:underline cursor-pointer',
        },
      }),
      ImageExtension.extend({
        addAttributes() {
            return {
                ...this.parent?.(),
                width: {
                    default: null,
                    parseHTML: element => element.getAttribute('width'),
                    renderHTML: attributes => {
                        if (!attributes.width) return {};
                        return { width: attributes.width };
                    }
                },
                height: {
                    default: null,
                    parseHTML: element => element.getAttribute('height'),
                    renderHTML: attributes => {
                        if (!attributes.height) return {};
                        return { height: attributes.height };
                    }
                }
            };
        },
        addOptions() {
            return { ...this.parent?.(), ctx: { rootDirHandle, filePath } };
        },
        addNodeView() {
            return ReactNodeViewRenderer(LocalImageComponent);
        }
      }).configure({ inline: true }),
      Placeholder.configure({
          placeholder: 'Start typing...',
      }),
      Markdown.configure({
        html: true, // Enable HTML so that image dimensions (e.g. <img width="200">) are preserved
      }),
      TabExtension,
    ],
    content: content, // Initialize content
    editorProps: {
        attributes: {
            class: 'prose dark:prose-invert prose-blue max-w-none focus:outline-none min-h-[500px] p-8 pb-[80vh]',
        }
    },
    onUpdate: ({ editor }) => {
       const markdown = (editor.storage as any).markdown.getMarkdown();
       onChange(markdown);
    }
  }, [rootDirHandle, filePath]);

  // Inject CSS for Headings
  useEffect(() => {
    const styleId = 'wysiwyg-heading-styles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.innerHTML = `
        .ProseMirror h1 { font-size: 2.25em; font-weight: 700; margin-top: 1.5em; margin-bottom: 0.5em; line-height: 1.1; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.3em; }
        .dark .ProseMirror h1 { border-color: #374151; color: #60a5fa; }
        .ProseMirror h2 { font-size: 1.5em; font-weight: 700; margin-top: 1.5em; margin-bottom: 0.5em; line-height: 1.3; }
        .dark .ProseMirror h2 { color: #93c5fd; }
        .ProseMirror h3 { font-size: 1.25em; font-weight: 600; margin-top: 1.25em; margin-bottom: 0.5em; }
        .dark .ProseMirror h3 { color: #bfdbfe; }
        .ProseMirror h4 { font-weight: 600; margin-top: 1em; }
      `;
      document.head.appendChild(style);
    }
  }, []);

  // Handle Image Paste
  useEffect(() => {
      if (!editor || !onPasteImage) return;

      editor.setOptions({
          editorProps: {
              handlePaste: (view, event) => {
                  const items = event.clipboardData?.items;
                  if (!items) return false;

                  for (let i = 0; i < items.length; i++) {
                      if (items[i].type.indexOf('image') !== -1) {
                          event.preventDefault();
                          const blob = items[i].getAsFile();
                          
                          if (blob) {
                              const previewUrl = URL.createObjectURL(blob);
                              
                              editor.chain()
                                  .focus()
                                  .insertContent({ type: 'paragraph' })
                                  .setImage({ src: previewUrl, alt: 'Uploading...', title: 'Uploading...' })
                                  .insertContent({ type: 'paragraph' })
                                  .run();

                              onPasteImage(blob).then((path) => {
                                  if (path) {
                                      editor.view.state.doc.descendants((node, pos) => {
                                          if (node.type.name === 'image' && node.attrs.src === previewUrl) {
                                              const tr = editor.view.state.tr.setNodeMarkup(pos, undefined, {
                                                  ...node.attrs,
                                                  src: path,
                                                  alt: '', 
                                                  title: ''
                                              });
                                              editor.view.dispatch(tr);
                                          }
                                      });
                                      URL.revokeObjectURL(previewUrl);
                                  }
                              });
                          }
                          return true;
                      }
                  }
                  return false;
              }
          }
      });
  }, [editor, onPasteImage]);

  return (
    <div className="h-full w-full overflow-y-auto bg-white dark:bg-[#1e1e1e] cursor-text" onClick={() => editor?.commands.focus()}>
      <EditorContent editor={editor} />
    </div>
  );
};

export default WysiwygEditor;
