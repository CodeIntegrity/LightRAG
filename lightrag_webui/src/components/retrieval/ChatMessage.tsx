import { lazy, Suspense, useState } from 'react'
import { LoaderIcon, ChevronDownIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Message } from '@/api/lightrag'
import { cn } from '@/lib/utils'

const ChatMessageMarkdown = lazy(() => import('./ChatMessageMarkdown'))

export type MessageWithError = Message & {
  id: string
  isError?: boolean
  isThinking?: boolean
  mermaidRendered?: boolean
  latexRendered?: boolean
}

const PlainMessageContent = ({
  content,
  className
}: {
  content: string
  className?: string
}) => (
  <div className={cn('whitespace-pre-wrap break-words text-sm', className)}>
    {content}
  </div>
)

export const ChatMessage = ({
  message,
  isTabActive = true
}: {
  message: MessageWithError
  isTabActive?: boolean
}) => {
  const { t } = useTranslation()
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(false)

  const { thinkingContent, displayContent, thinkingTime, isThinking } = message

  const finalThinkingContent = thinkingContent
  const finalDisplayContent =
    message.role === 'user'
      ? message.content
      : displayContent !== undefined
        ? displayContent
        : message.content || ''

  return (
    <div
      className={`${
        message.role === 'user'
          ? 'max-w-[80%] bg-primary text-primary-foreground'
          : message.isError
            ? 'w-[95%] bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400'
            : 'w-[95%] bg-muted'
      } rounded-lg px-4 py-2`}
    >
      {message.role === 'assistant' && (isThinking || thinkingTime !== null) && (
        <div className={cn('mb-2', !isTabActive && 'opacity-50')}>
          <div
            className="flex cursor-pointer items-center text-sm text-gray-500 transition-colors duration-200 select-none hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            onClick={() => {
              if (finalThinkingContent && finalThinkingContent.trim() !== '') {
                setIsThinkingExpanded(!isThinkingExpanded)
              }
            }}
          >
            {isThinking ? (
              <>
                {isTabActive && <LoaderIcon className="mr-2 size-4 animate-spin" />}
                <span>{t('retrievePanel.chatMessage.thinking')}</span>
              </>
            ) : (
              typeof thinkingTime === 'number' && (
                <span>
                  {t('retrievePanel.chatMessage.thinkingTime', {
                    time: thinkingTime
                  })}
                </span>
              )
            )}
            {finalThinkingContent && finalThinkingContent.trim() !== '' && (
              <ChevronDownIcon
                className={`ml-2 size-4 shrink-0 transition-transform ${
                  isThinkingExpanded ? 'rotate-180' : ''
                }`}
              />
            )}
          </div>
          {isThinkingExpanded &&
            finalThinkingContent &&
            finalThinkingContent.trim() !== '' && (
              <div className="mt-2 border-l-2 border-primary/20 pl-4 text-sm text-foreground dark:border-primary/40">
                {isThinking && (
                  <div className="mb-2 text-xs text-gray-400 italic dark:text-gray-300">
                    {t(
                      'retrievePanel.chatMessage.thinkingInProgress',
                      'Thinking in progress...'
                    )}
                  </div>
                )}
                <Suspense
                  fallback={
                    <PlainMessageContent
                      content={finalThinkingContent}
                      className="text-sm"
                    />
                  }
                >
                  <ChatMessageMarkdown
                    content={finalThinkingContent}
                    messageRole={message.role}
                    mermaidRendered={message.mermaidRendered ?? false}
                    latexRendered={message.latexRendered ?? true}
                    variant="thinking"
                  />
                </Suspense>
              </div>
            )}
        </div>
      )}

      {finalDisplayContent && (
        <div className="relative">
          <Suspense
            fallback={
              <PlainMessageContent
                content={finalDisplayContent}
                className={
                  message.role === 'user'
                    ? 'text-primary-foreground'
                    : 'text-foreground'
                }
              />
            }
          >
            <ChatMessageMarkdown
              content={finalDisplayContent}
              messageRole={message.role}
              mermaidRendered={message.mermaidRendered ?? false}
              latexRendered={message.latexRendered ?? true}
              variant="main"
            />
          </Suspense>
        </div>
      )}

      {isTabActive &&
        (() => {
          const hasVisibleContent =
            finalDisplayContent && finalDisplayContent.trim() !== ''
          const isLoadingState = !hasVisibleContent && !isThinking && !thinkingTime
          return isLoadingState ? (
            <LoaderIcon className="animate-spin duration-2000" />
          ) : null
        })()}
    </div>
  )
}
