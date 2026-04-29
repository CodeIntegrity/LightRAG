import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/components/ui/Button'
import { PromptEditorSection } from '@/utils/promptVersioning'

type PromptQuickTestPanelProps = {
  sections: PromptEditorSection[]
  payload: Record<string, unknown>
}

const SAMPLE_VALUES: Record<string, string> = {
  context_data: '[Retrieved context: Entity A (Alice, researcher) collaborates with Entity B (Bob, mathematician) on quantum computing research at Organization C (MIT).]',
  response_type: 'Multiple Paragraphs',
  user_prompt: '[User additional instructions: Use mermaid format for diagrams]',
  entity_types: 'person, organization, location, event, technology',
  language: 'English',
  tuple_delimiter: '<|>',
  completion_delimiter: '<|COMPLETE|>',
  input_text: '[Document text to process: Alice and Bob are collaborating on quantum computing research at MIT. Their recent paper explores entanglement-based protocols for secure communication...]',
  examples: '[Few-shot examples showing expected extraction format]',
  entities_str: JSON.stringify([
    { entity: 'Alice', type: 'PERSON', description: 'A researcher specializing in quantum physics' },
    { entity: 'Bob', type: 'PERSON', description: 'A mathematician' },
    { entity: 'MIT', type: 'ORGANIZATION', description: 'Massachusetts Institute of Technology' }
  ], null, 2),
  relations_str: JSON.stringify([
    { source: 'Alice', target: 'Bob', description: 'collaborates with', weight: 1.0 },
    { source: 'Alice', target: 'MIT', description: 'works at', weight: 1.0 }
  ], null, 2),
  text_chunks_str: JSON.stringify([
    { id: 'chunk-1', content: 'Alice and Bob are collaborating on quantum computing research at MIT.' },
    { id: 'chunk-2', content: 'Their recent paper explores entanglement-based protocols.' }
  ], null, 2),
  reference_list_str: JSON.stringify([
    { reference_id: '1', file_path: 'quantum_research.pdf' },
    { reference_id: '2', file_path: 'mit_publications.txt' }
  ], null, 2),
  query: '[User query: Who is collaborating on quantum computing research?]',
  description_list: JSON.stringify([
    'Alice is a researcher specializing in quantum physics.',
    'Alice works at MIT on quantum computing.',
    'Alice collaborates with Bob on research projects.'
  ], null, 2),
  description_type: 'entity',
  description_name: 'Alice',
  summary_length: '100 words',
  content_data: '[Retrieved content: Alice and Bob collaborate on quantum computing at MIT.]'
}

const resolveSampleValue = (variableName: string): string => {
  const key = variableName.replace(/[{}]/g, '').trim()
  return SAMPLE_VALUES[key] ?? `[value for ${variableName}]`
}

const substituteVariables = (template: string): string => {
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    return SAMPLE_VALUES[name] ?? `[value for {${name}}]`
  })
}

const highlightVariables = (text: string): React.ReactNode[] => {
  const parts = text.split(/(\{\w+\})/g)
  return parts.map((part, index) => {
    if (/^\{\w+\}$/.test(part)) {
      return (
        <span key={index} className="rounded bg-amber-100 px-0.5 font-mono text-[11px] text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
          {part}
        </span>
      )
    }
    return <span key={index}>{part}</span>
  })
}

const getValueAtPath = (payload: Record<string, unknown>, path: string): unknown => {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[segment]
  }, payload)
}

export default function PromptQuickTestPanel({ sections, payload }: PromptQuickTestPanelProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [mode, setMode] = useState<'raw' | 'preview'>('raw')
  const [expandedField, setExpandedField] = useState<string | null>(null)

  const fields = useMemo(() => {
    return sections
      .filter((section) => section.type === 'textarea' || section.type === 'csv' || section.type === 'input')
      .map((section) => {
        const value = getValueAtPath(payload, section.key)
        const rawText = typeof value === 'string'
          ? value
          : Array.isArray(value)
            ? value.join(', ')
            : ''
        const previewText = substituteVariables(rawText)
        return {
          key: section.key,
          title: section.title,
          rawText,
          previewText,
          variables: section.variables
        }
      })
      .filter((field) => field.rawText.length > 0)
  }, [sections, payload])

  if (fields.length === 0) {
    return null
  }

  return (
    <div className="rounded-lg border border-dashed border-border/60">
      <button
        type="button"
        className="flex w-full items-center justify-between p-3 text-left"
        onClick={() => setExpanded((current) => !current)}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">{t('promptManagement.quickTestTitle')}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            {fields.length} {t('promptManagement.quickTestFields')}
          </span>
        </div>
        <span className="text-xs text-blue-500">
          {expanded ? t('promptManagement.collapse') : t('promptManagement.edit')}
        </span>
      </button>

      {expanded && (
        <div className="border-t p-3 space-y-3">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={mode === 'raw' ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setMode('raw')}
            >
              {t('promptManagement.quickTestRaw')}
            </Button>
            <Button
              type="button"
              variant={mode === 'preview' ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setMode('preview')}
            >
              {t('promptManagement.quickTestPreview')}
            </Button>
          </div>

          <div className="space-y-2">
            {fields.map((field) => {
              const text = mode === 'raw' ? field.rawText : field.previewText
              const isExpanded = expandedField === field.key
              return (
                <div key={field.key} className="rounded-md border border-border/60">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between p-2 text-left"
                    onClick={() => setExpandedField((current) => current === field.key ? null : field.key)}
                  >
                    <span className="font-mono text-[11px] font-medium text-muted-foreground">
                      {field.title}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {isExpanded ? t('promptManagement.collapse') : t('promptManagement.edit')}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="border-t p-3">
                      <pre className="whitespace-pre-wrap break-all text-xs leading-5 font-mono">
                        {mode === 'raw'
                          ? highlightVariables(text)
                          : highlightVariables(text)}
                      </pre>
                      {mode === 'preview' && (
                        <div className="mt-2 rounded bg-muted/30 p-2 text-[10px] text-muted-foreground">
                          <div className="font-medium mb-1">{t('promptManagement.quickTestVariableValues')}</div>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                            {field.variables.map((variable) => (
                              <div key={`${field.key}-${variable.label}`} className="flex items-baseline gap-1">
                                <span className="font-mono text-amber-600 dark:text-amber-400">
                                  {variable.label}
                                </span>
                                <span className="text-muted-foreground">→</span>
                                <span className="truncate">
                                  {resolveSampleValue(variable.label).slice(0, 60)}
                                  {resolveSampleValue(variable.label).length > 60 ? '...' : ''}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
