import { describe, expect, test } from 'vitest'
import { resolveWorkspaceLabel } from './WorkspaceSwitcher'

describe('WorkspaceSwitcher', () => {
  test('renders cached display name for the current workspace', () => {
    const label = resolveWorkspaceLabel(
      'books',
      { books: 'Books Library' },
      (_key, fallback) => fallback ?? _key
    )

    expect(label).toBe('Books Library')
  })

  test('falls back to workspace key when no cached display name exists', () => {
    const label = resolveWorkspaceLabel(
      'books',
      {},
      (_key, fallback) => fallback ?? _key
    )

    expect(label).toBe('books')
  })
})
