

import React, { useState, useEffect, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import { FileSystemDirectoryHandle } from '../types';
import { Icons } from './Icon';

interface MarkdownPreviewProps {
  content: string;
  rootDirHandle?: FileSystemDirectoryHandle;
  filePath?: string; // Relative path of the current file (e.g. "docs/intro.md")
  onFileLinkClick?: (target: string) => void;
  scrollToAnchor?: string | null;
}

// Custom renderer for wiki links
const processWikiLinks = (text: string) => {
  return text.replace(/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, (_, target, __, alias) => {
    const display = alias || target;
    return `[${display}](#${target})`;
  });
};

// Helper to resolve relative paths against a base file path
const resolvePath = (basePath: string, relativePath: string): string => {
  // If no base path or relative path is absolute/root-relative
  if (!basePath || relativePath.startsWith('/')) {
      return relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
  }
  
  if (relativePath.startsWith('http') || relativePath.startsWith('data:')) return relativePath;

  const stack = basePath.split('/');
  stack.pop(); // Remove the filename from base path to get directory

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

// Component to handle async image loading from local directory
const LocalImage: React.FC<{ src?: string; alt?: string; rootDirHandle?: FileSystemDirectoryHandle; filePath?: string }> = ({ src, alt, rootDirHandle, filePath, ...props }) => {
  const [imgSrc, setImgSrc] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let isMounted = true;

    const loadLocalImage = async () => {
      setLoading(true);
      setError(false);

      if (!src) {
          setLoading(false);
          return;
      }
      
      // 1. If it's an external link or data URI, use directly
      if (src.startsWith('http') || src.startsWith('https') || src.startsWith('data:')) {
        if (isMounted) {
            setImgSrc(src);
            setLoading(false);
        }
        return;
      }

      // 2. If we have a directory handle, try to load from FS
      if (rootDirHandle) {
          try {
            // Resolve the path relative to the current file
            const resolvedPath = resolvePath(filePath || '', src);
            
            const parts = resolvedPath.split('/');
            const fileName = parts.pop();
            
            if (!fileName) throw new Error("Invalid path");

            // Traverse directories
            let currentDir = rootDirHandle;
            for (const part of parts) {
                currentDir = await currentDir.getDirectoryHandle(part);
            }

            const fileHandle = await currentDir.getFileHandle(fileName);
            const file = await fileHandle.getFile();
            objectUrl = URL.createObjectURL(file);
            
            if (isMounted) {
              setImgSrc(objectUrl);
              setLoading(false);
            }
          } catch (error) {
            console.warn(`Could not load local image: ${src}`, error);
            if (isMounted) {
                setError(true);
                setLoading(false);
            }
          }
      } else {
          // No root dir, can't resolve relative paths
          if (isMounted) {
             setError(true);
             setLoading(false);
          }
      }
    };

    loadLocalImage();

    return () => {
      isMounted = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [src, rootDirHandle, filePath]);

  if (loading) {
      return (
          <div className="inline-block bg-gray-200 dark:bg-gray-800 rounded animate-pulse flex items-center justify-center text-xs text-gray-500" style={{ width: '100px', height: '100px', margin: '1rem 0' }}>
              Loading...
          </div>
      );
  }

  if (error || !imgSrc) {
      return (
          <span className="inline-flex items-center gap-1 text-red-500 dark:text-red-400 text-xs bg-red-100 dark:bg-red-900/20 px-2 py-1 rounded border border-red-200 dark:border-red-900/50 my-2">
              <Icons.FileText size={12} /> Image not found: {src}
          </span>
      );
  }

  return (
    <img 
      src={imgSrc} 
      alt={alt} 
      className="max-w-full h-auto rounded-lg shadow-md my-4 border border-gray-200 dark:border-gray-800"
      {...props} 
    />
  );
};

const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({ content, rootDirHandle, filePath, onFileLinkClick, scrollToAnchor }) => {
  const processedContent = useMemo(() => processWikiLinks(content), [content]);
  
  // Use a ref for the callback to keep the 'components' object stable
  const onLinkClickRef = useRef(onFileLinkClick);
  useEffect(() => {
      onLinkClickRef.current = onFileLinkClick;
  }, [onFileLinkClick]);

  // Stable components definition
  const components = useMemo(() => ({
    code({ node, inline, className, children, ...props }: any) {
      return (
        <code className={`${className} bg-gray-100 dark:bg-gray-800 rounded px-1 text-pink-600 dark:text-pink-400 font-mono text-sm border border-gray-200 dark:border-gray-700`} {...props}>
          {children}
        </code>
      );
    },
    pre({ children }: any) {
      return <pre className="bg-gray-50 dark:bg-[#1e1e1e] border border-gray-200 dark:border-gray-700 rounded p-4 overflow-x-auto my-4">{children}</pre>;
    },
    img({ src, alt, ...props }: any) {
      return <LocalImage src={src} alt={alt} rootDirHandle={rootDirHandle} filePath={filePath} {...props} />;
    },
    a({ href, children }: any) {
        const isInternal = href?.startsWith('#');
        return (
            <a 
            href={href} 
            onClick={(e) => {
                if (isInternal && onLinkClickRef.current) {
                    e.preventDefault();
                    // Remove the '#' prefix to get the filename/target
                    const target = href!.substring(1);
                    onLinkClickRef.current(target);
                }
            }}
            className={isInternal ? "text-blue-600 dark:text-blue-400 no-underline border-b border-blue-400/50 hover:border-blue-500 hover:text-blue-500 dark:hover:text-blue-300 cursor-pointer transition-colors" : "text-blue-600 dark:text-blue-400 hover:underline"}
            >
                {children}
            </a>
        )
    },
    blockquote({ children }: any) {
        return <blockquote className="border-l-4 border-blue-500/50 pl-4 text-gray-600 dark:text-gray-400 italic my-4 bg-gray-100 dark:bg-gray-800/20 py-2 pr-2 rounded-r">{children}</blockquote>
    },
    h1({ children, id }: any) {
        return <h1 id={id} className="text-3xl font-bold text-gray-900 dark:text-blue-400 mt-8 mb-4 border-b border-gray-200 dark:border-gray-800 pb-2">{children}</h1>
    },
    h2({ children, id }: any) {
        return <h2 id={id} className="text-2xl font-bold text-gray-800 dark:text-blue-300 mt-6 mb-3">{children}</h2>
    },
    h3({ children, id }: any) {
        return <h3 id={id} className="text-xl font-bold text-gray-700 dark:text-blue-200 mt-4 mb-2">{children}</h3>
    }
  }), [rootDirHandle, filePath]); // Recreate if rootDirHandle or filePath changes

  // Handle Scroll to Anchor
  useEffect(() => {
    if (scrollToAnchor) {
        setTimeout(() => {
            const headers = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
            const match = headers.find(h => {
                 return h.id === scrollToAnchor || 
                        h.textContent?.toLowerCase().replace(/\s+/g, '-') === scrollToAnchor.toLowerCase();
            });

            if (match) {
                match.scrollIntoView({ behavior: 'smooth', block: 'start' });
                match.classList.add('bg-yellow-100', 'dark:bg-blue-900/40', 'transition-colors', 'duration-1000');
                setTimeout(() => match.classList.remove('bg-yellow-100', 'dark:bg-blue-900/40'), 2000);
            }
        }, 100);
    }
  }, [scrollToAnchor, content]);

  return (
    <div className="h-full w-full overflow-y-auto bg-white dark:bg-[#1e1e1e] text-gray-900 dark:text-[#cccccc] p-8 pb-[80vh] prose dark:prose-invert prose-blue max-w-none transition-colors duration-200">
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownPreview;