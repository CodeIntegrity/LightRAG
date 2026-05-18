import { memo, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeReact from 'rehype-react'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import mermaid from 'mermaid'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/cjs/styles/prism'

import { cn } from '@/lib/utils'
import useTheme from '@/hooks/useTheme'
import { remarkFootnotes } from '@/utils/remarkFootnotes'

interface KaTeXOptions {
  errorColor?: string
  throwOnError?: boolean
  displayMode?: boolean
  strict?: boolean
  trust?: boolean
  errorCallback?: (error: string, latex: string) => void
}

interface MarkdownContentProps {
  content: string
  className?: string
  inlineCodeTone?: 'default' | 'inverse'
  renderMermaid?: boolean
  latexRendered?: boolean
  allowHtml?: boolean
}

interface CodeHighlightProps {
  inline?: boolean
  className?: string
  children?: ReactNode
  renderAsDiagram?: boolean
  inlineCodeTone?: 'default' | 'inverse'
}

export const DEFAULT_MARKDOWN_CONTENT_CLASSNAME =
  'prose dark:prose-invert max-w-none break-words text-sm prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 [&_.katex]:text-current [&_.katex-display]:my-4 [&_.katex-display]:max-w-full [&_.katex-display_>.base]:overflow-x-auto [&_sup]:text-[0.75em] [&_sup]:align-[0.1em] [&_sup]:leading-[0] [&_sub]:text-[0.75em] [&_sub]:align-[-0.2em] [&_sub]:leading-[0] [&_mark]:bg-yellow-200 [&_mark]:dark:bg-yellow-800 [&_u]:underline [&_del]:line-through [&_ins]:underline [&_ins]:decoration-green-500 [&_.footnotes]:mt-8 [&_.footnotes]:border-t [&_.footnotes]:pt-4 [&_.footnotes_ol]:text-sm [&_.footnotes_li]:my-1 text-foreground [&_.footnotes]:border-border [&_a[href^="#fn"]]:text-primary [&_a[href^="#fn"]]:no-underline [&_a[href^="#fn"]]:hover:underline [&_a[href^="#fnref"]]:text-primary [&_a[href^="#fnref"]]:no-underline [&_a[href^="#fnref"]]:hover:underline'

const isLargeJson = (
  language: string | undefined,
  content: string | undefined
): boolean => {
  if (!content || language !== 'json') return false
  return content.length > 5000
}

const buildKatexOptions = (theme: string): KaTeXOptions => ({
  errorColor: theme === 'dark' ? '#ef4444' : '#dc2626',
  throwOnError: false,
  displayMode: false,
  strict: false,
  trust: true,
  errorCallback: (error: string, latex: string) => {
    if (process.env.NODE_ENV === 'development') {
      console.warn('KaTeX rendering error:', error, 'for LaTeX:', latex)
    }
  }
})

const CodeHighlight = memo(
  ({
    inline,
    className,
    children,
    renderAsDiagram = false,
    inlineCodeTone = 'default',
    ...props
  }: CodeHighlightProps) => {
    const { theme } = useTheme()
    const [hasRendered, setHasRendered] = useState(false)
    const match = className?.match(/language-(\w+)/)
    const language = match ? match[1] : undefined
    const mermaidRef = useRef<HTMLDivElement>(null)
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const contentStr = String(children || '').replace(/\n$/, '')
    const isLargeJsonBlock = isLargeJson(language, contentStr)

    useEffect(() => {
      if (
        renderAsDiagram &&
        !hasRendered &&
        language === 'mermaid' &&
        mermaidRef.current
      ) {
        const container = mermaidRef.current

        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current)
        }

        debounceTimerRef.current = setTimeout(() => {
          if (hasRendered || !container) return

          try {
            mermaid.initialize({
              startOnLoad: false,
              theme: theme === 'dark' ? 'dark' : 'default',
              securityLevel: 'loose',
              suppressErrorRendering: true
            })

            container.innerHTML =
              '<div class="flex items-center justify-center p-4"><svg class="h-5 w-5 animate-spin text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg></div>'

            const rawContent = String(children).replace(/\n$/, '').trim()
            const looksPotentiallyComplete =
              rawContent.length > 10 &&
              (rawContent.startsWith('graph') ||
                rawContent.startsWith('sequenceDiagram') ||
                rawContent.startsWith('classDiagram') ||
                rawContent.startsWith('stateDiagram') ||
                rawContent.startsWith('gantt') ||
                rawContent.startsWith('pie') ||
                rawContent.startsWith('flowchart') ||
                rawContent.startsWith('erDiagram'))

            if (!looksPotentiallyComplete) {
              return
            }

            const processedContent = rawContent
              .split('\n')
              .map((line) => {
                const trimmedLine = line.trim()
                if (trimmedLine.startsWith('subgraph')) {
                  const parts = trimmedLine.split(' ')
                  if (parts.length > 1) {
                    const title = parts
                      .slice(1)
                      .join(' ')
                      .replace(/["']/g, '')
                    return `subgraph "${title}"`
                  }
                }
                return trimmedLine
              })
              .filter((line) => !line.trim().startsWith('linkStyle'))
              .join('\n')

            const mermaidId = `mermaid-${Date.now()}`
            mermaid
              .render(mermaidId, processedContent)
              .then(({ svg, bindFunctions }) => {
                if (mermaidRef.current === container && !hasRendered) {
                  container.innerHTML = svg
                  setHasRendered(true)
                  if (bindFunctions) {
                    try {
                      bindFunctions(container)
                    } catch (bindError) {
                      console.error('Mermaid bindFunctions error:', bindError)
                      container.innerHTML +=
                        '<p class="text-xs text-orange-500">Diagram interactions might be limited.</p>'
                    }
                  }
                }
              })
              .catch((error) => {
                console.error('Mermaid rendering promise error (debounced):', error)
                if (mermaidRef.current === container) {
                  const errorMessage =
                    error instanceof Error ? error.message : String(error)
                  const errorPre = document.createElement('pre')
                  errorPre.className =
                    'text-xs text-red-500 whitespace-pre-wrap break-words'
                  errorPre.textContent = `Mermaid diagram error: ${errorMessage}\n\nContent:\n${processedContent}`
                  container.innerHTML = ''
                  container.appendChild(errorPre)
                }
              })
          } catch (error) {
            console.error('Mermaid synchronous error (debounced):', error)
            if (mermaidRef.current === container) {
              const errorMessage =
                error instanceof Error ? error.message : String(error)
              const errorPre = document.createElement('pre')
              errorPre.className =
                'text-xs text-red-500 whitespace-pre-wrap break-words'
              errorPre.textContent = `Mermaid diagram setup error: ${errorMessage}`
              container.innerHTML = ''
              container.appendChild(errorPre)
            }
          }
        }, 300)
      }

      return () => {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current)
        }
      }
    }, [renderAsDiagram, hasRendered, language, children, theme])

    if (isLargeJsonBlock) {
      return (
        <pre className="bg-muted rounded-md p-4 font-mono text-sm whitespace-pre-wrap break-words overflow-x-auto">
          {contentStr}
        </pre>
      )
    }

    if (language === 'mermaid' && !renderAsDiagram) {
      return (
        <SyntaxHighlighter
          style={theme === 'dark' ? oneDark : oneLight}
          PreTag="div"
          language="text"
          {...props}
        >
          {contentStr}
        </SyntaxHighlighter>
      )
    }

    if (language === 'mermaid') {
      return (
        <div
          className="mermaid-diagram-container my-4 overflow-x-auto"
          ref={mermaidRef}
        />
      )
    }

    const isInline = inline ?? !className?.startsWith('language-')
    const inlineCodeStyles =
      inlineCodeTone === 'inverse'
        ? 'bg-primary-foreground/20 text-primary-foreground border border-primary-foreground/30'
        : theme === 'dark'
          ? 'bg-muted-foreground/20 text-muted-foreground border border-muted-foreground/30'
          : 'bg-slate-200 text-slate-800 border border-slate-300'

    return !isInline ? (
      <SyntaxHighlighter
        style={theme === 'dark' ? oneDark : oneLight}
        PreTag="div"
        language={language}
        {...props}
      >
        {contentStr}
      </SyntaxHighlighter>
    ) : (
      <code
        className={cn(
          className,
          'mx-1 rounded-sm px-1 py-0.5 font-mono text-sm',
          inlineCodeStyles
        )}
        {...props}
      >
        {children}
      </code>
    )
  }
)

CodeHighlight.displayName = 'CodeHighlight'

export default function MarkdownContent({
  content,
  className,
  inlineCodeTone = 'default',
  renderMermaid = false,
  latexRendered = true,
  allowHtml = false
}: MarkdownContentProps) {
  const { theme } = useTheme()

  const markdownComponents = useMemo(
    () => ({
      code: (props: any) => {
        const { inline, className: codeClassName, children, ...restProps } = props
        const match = /language-(\w+)/.exec(codeClassName || '')
        const language = match ? match[1] : undefined

        if (language === 'math' && !inline) {
          return (
            <div className="katex-display-wrapper my-4 overflow-x-auto">
              <div className="text-current">{children}</div>
            </div>
          )
        }

        if (language === 'math' && inline) {
          return (
            <span className="katex-inline-wrapper">
              <span className="text-current">{children}</span>
            </span>
          )
        }

        return (
          <CodeHighlight
            inline={inline}
            className={codeClassName}
            {...restProps}
            renderAsDiagram={renderMermaid}
            inlineCodeTone={inlineCodeTone}
          >
            {children}
          </CodeHighlight>
        )
      },
      p: ({ children }: { children?: ReactNode }) => (
        <div className="my-2">{children}</div>
      ),
      h1: ({ children }: { children?: ReactNode }) => (
        <h1 className="mt-4 mb-2 text-xl font-bold">{children}</h1>
      ),
      h2: ({ children }: { children?: ReactNode }) => (
        <h2 className="mt-4 mb-2 text-lg font-bold">{children}</h2>
      ),
      h3: ({ children }: { children?: ReactNode }) => (
        <h3 className="mt-3 mb-2 text-base font-bold">{children}</h3>
      ),
      h4: ({ children }: { children?: ReactNode }) => (
        <h4 className="mt-3 mb-2 text-base font-semibold">{children}</h4>
      ),
      ul: ({ children }: { children?: ReactNode }) => (
        <ul className="my-2 list-disc pl-5">{children}</ul>
      ),
      ol: ({ children }: { children?: ReactNode }) => (
        <ol className="my-2 list-decimal pl-5">{children}</ol>
      ),
      li: ({ children }: { children?: ReactNode }) => (
        <li className="my-1">{children}</li>
      )
    }),
    [inlineCodeTone, renderMermaid]
  )

  const rehypePlugins: any[] = []

  if (allowHtml) {
    rehypePlugins.push(rehypeRaw)
  }

  if (latexRendered) {
    rehypePlugins.push([rehypeKatex, buildKatexOptions(theme)])
  }

  rehypePlugins.push(rehypeReact)

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkFootnotes, remarkMath]}
        rehypePlugins={rehypePlugins}
        skipHtml={!allowHtml}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
