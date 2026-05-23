import { useCallback, useEffect, useMemo, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { yaml as yamlLang } from '@codemirror/lang-yaml'
import useTheme from '@/hooks/useTheme'
import { cn } from '@/lib/utils'

export type YamlEditorProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

export default function YamlEditor({
  value,
  onChange,
  placeholder,
  className
}: YamlEditorProps) {
  const { theme } = useTheme()
  const [isDark, setIsDark] = useState(
    () =>
      theme === 'dark' ||
      (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  )

  useEffect(() => {
    if (theme !== 'system') {
      setIsDark(theme === 'dark')
      return
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  const extensions = useMemo(() => [yamlLang()], [])

  const handleChange = useCallback(
    (val: string) => onChange(val),
    [onChange]
  )

  return (
    <CodeMirror
      className={cn('flex-1 overflow-auto', className)}
      value={value}
      extensions={extensions}
      theme={isDark ? 'dark' : 'light'}
      placeholder={placeholder}
      onChange={handleChange}
      indentWithTab
    />
  )
}
