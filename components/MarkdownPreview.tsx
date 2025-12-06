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

// Component to handle async image loading from local directory
const LocalImage: React.FC<{ src?: string; alt?: string; rootDirHandle?: FileSystemDirectoryHandle }> = ({ src, alt, rootDirHandle, ...props }) => {
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
            // Remove ./ prefix if present for filesystem lookup
            const fileName = src.replace(/^\.\//, '');
            const fileHandle = await rootDirHandle.getFileHandle(fileName);
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
  }, [src, rootDirHandle]);

  if (loading) {
      return (
          <div className="inline-block bg-gray-800 rounded animate-pulse flex items-center justify-center text-xs text-gray-500" style={{ width: '100px', height: '100px', margin: '1rem 0' }}>
              Loading...
          </div>
      );
  }

  if (error || !imgSrc) {
      return (
          <span className="inline-flex items-center gap-1 text-red-400 text-xs bg-red-900/20 px-2 py-1 rounded border border-red-900/50 my-2">
              <Icons.FileText size={12} /> Image not found: {src}
          </span>
      );
  }

  return (
    <img 
      src={imgSrc} 
      alt={alt} 
      className="max-w-full h-auto rounded-lg shadow-md my-4 border border-gray-800"
      {...props} 
    />
  );
};

const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({ content, rootDirHandle, onFileLinkClick, scrollToAnchor }) => {
  const processedContent = useMemo(() => processWikiLinks(content), [content]);
  
  // Use a ref for the callback to keep the 'components' object stable
  // This prevents ReactMarkdown from unmounting/remounting components (like images) on every render
  const onLinkClickRef = useRef(onFileLinkClick);
  useEffect(() => {
      onLinkClickRef.current = onFileLinkClick;
  }, [onFileLinkClick]);

  // Stable components definition
  const components = useMemo(() => ({
    code({ node, inline, className, children, ...props }: any) {
      return (
        <code className={`${className} bg-gray-800 rounded px-1 text-pink-400 font-mono text-sm border border-gray-700`} {...props}>
          {children}
        </code>
      );
    },
    pre({ children }: any) {
      return <pre className="bg-[#1e1e1e] border border-gray-700 rounded p-4 overflow-x-auto my-4">{children}</pre>;
    },
    img({ src, alt, ...props }: any) {
      return <LocalImage src={src} alt={alt} rootDirHandle={rootDirHandle} {...props} />;
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
            className={isInternal ? "text-blue-400 no-underline border-b border-blue-400/50 hover:border-blue-400 hover:text-blue-300 cursor-pointer transition-colors" : "text-blue-400 hover:underline"}
            >
                {children}
            </a>
        )
    },
    blockquote({ children }: any) {
        return <blockquote className="border-l-4 border-blue-500/50 pl-4 text-gray-400 italic my-4 bg-gray-800/20 py-2 pr-2 rounded-r">{children}</blockquote>
    },
    h1({ children, id }: any) {
        return <h1 id={id} className="text-3xl font-bold text-blue-400 mt-8 mb-4 border-b border-gray-800 pb-2">{children}</h1>
    },
    h2({ children, id }: any) {
        return <h2 id={id} className="text-2xl font-bold text-blue-300 mt-6 mb-3">{children}</h2>
    },
    h3({ children, id }: any) {
        return <h3 id={id} className="text-xl font-bold text-blue-200 mt-4 mb-2">{children}</h3>
    }
  }), [rootDirHandle]); // Only recreate if rootDirHandle changes

  // Handle Scroll to Anchor
  useEffect(() => {
    if (scrollToAnchor) {
        // Wait for render
        setTimeout(() => {
            // Try to find element by ID (if remark-slug was used, but we use manual matching for now)
            // Or look for headers with matching text
            const headers = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
            const match = headers.find(h => {
                 // specific id match or text match
                 return h.id === scrollToAnchor || 
                        h.textContent?.toLowerCase().replace(/\s+/g, '-') === scrollToAnchor.toLowerCase();
            });

            if (match) {
                match.scrollIntoView({ behavior: 'smooth', block: 'start' });
                // Highlight effect
                match.classList.add('bg-blue-900/40', 'transition-colors', 'duration-1000');
                setTimeout(() => match.classList.remove('bg-blue-900/40'), 2000);
            }
        }, 100);
    }
  }, [scrollToAnchor, content]);

  return (
    <div className="h-full w-full overflow-y-auto bg-[#1e1e1e] text-[#cccccc] p-8 prose prose-invert prose-blue max-w-none">
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