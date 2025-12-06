import React, { useRef, useEffect } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { FileSystemFileHandle } from '../types';

interface EditorPaneProps {
  fileId: string;
  content: string;
  language?: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onPasteImage?: (blob: Blob) => Promise<string | null>;
  onFileLinkClick?: (target: string) => void;
  scrollToAnchor?: string | null;
}

const EditorPane: React.FC<EditorPaneProps> = ({ 
  fileId, 
  content, 
  language = 'markdown', 
  onChange,
  onSave,
  onPasteImage,
  onFileLinkClick,
  scrollToAnchor
}) => {
  const editorRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    // We do NOT add Ctrl+S command here anymore because it is handled 
    // globally in App.tsx with { capture: true } to prevent browser defaults reliably.

    editor.updateOptions({
      wordWrap: 'on',
      minimap: { enabled: true },
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      padding: { top: 16 },
      fontFamily: "'Fira Code', 'Droid Sans Mono', 'monospace', monospace",
      fontSize: 14,
    });

    // Handle Link Click (Ctrl+Click or Double Click)
    editor.onMouseDown((e) => {
      if (!onFileLinkClick) return;

      const isCtrlCmd = e.event.ctrlKey || e.event.metaKey;
      const isDoubleClick = e.event.browserEvent.detail === 2;

      // React to Ctrl+Click OR Double Click on content text
      if ((isCtrlCmd || isDoubleClick) && e.target.type === monaco.editor.MouseTargetType.CONTENT_TEXT && e.target.position) {
          const model = editor.getModel();
          if (!model) return;
          
          const position = e.target.position;
          const lineContent = model.getLineContent(position.lineNumber);
          
          // Regex to find wiki links: [[Target]] or [[Target|Alias]]
          const regex = /\[\[([^\]|]+)(\|([^\]]+))?\]\]/g;
          let match;
          
          while ((match = regex.exec(lineContent)) !== null) {
              const startCol = match.index + 1;
              const endCol = startCol + match[0].length;
              
              // Check if click position is within the brackets
              if (position.column >= startCol && position.column <= endCol) {
                  const target = match[1];
                  // Use a timeout to ensure the event isn't swallowed
                  setTimeout(() => onFileLinkClick(target), 0);
                  return;
              }
          }
      }
    });
  };

  // Handle global paste events within the editor container
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      if (!onPasteImage) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          e.preventDefault();
          const blob = items[i].getAsFile();
          if (blob) {
            // Call the parent handler to save the image and get the syntax
            const fileName = await onPasteImage(blob);
            if (fileName && editorRef.current) {
              const editor = editorRef.current;
              const position = editor.getPosition();
              const text = `![Image](${fileName})`;
              editor.executeEdits('paste-image', [{
                range: {
                  startLineNumber: position.lineNumber,
                  startColumn: position.column,
                  endLineNumber: position.lineNumber,
                  endColumn: position.column
                },
                text: text,
                forceMoveMarkers: true
              }]);
            }
          }
          break; // Handle one image at a time
        }
      }
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener('paste', handlePaste);
    }
    return () => {
      if (container) {
        container.removeEventListener('paste', handlePaste);
      }
    };
  }, [onPasteImage]);

  // Handle Scroll to Anchor
  useEffect(() => {
      if (editorRef.current && scrollToAnchor) {
          const editor = editorRef.current;
          const model = editor.getModel();
          if (!model) return;

          // Simple search for markdown headers corresponding to the anchor
          // Normalized: Remove hyphens or match loosely if possible
          // For now, exact text match on headers
          
          // Try to find "## Heading" where Heading roughly matches anchor
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
    <div ref={containerRef} className="h-full w-full overflow-hidden">
      <Editor
        height="100%"
        theme="vs-dark"
        path={fileId} // Important for Monaco model caching per file
        defaultLanguage={language}
        defaultValue={content} // Only used for initial load of a new model
        // value={content} // REMOVED: Must be uncontrolled to prevent cursor jumps during IME
        onChange={(value) => onChange(value || '')}
        onMount={handleEditorDidMount}
        options={{
          selectOnLineNumbers: true,
          automaticLayout: true,
          renderWhitespace: 'selection',
          scrollBeyondLastLine: false,
        }}
      />
    </div>
  );
};

export default EditorPane;