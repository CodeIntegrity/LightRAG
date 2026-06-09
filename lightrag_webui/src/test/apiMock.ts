import { vi } from 'vitest'

export const createLightragApiMock = (overrides: Record<string, unknown> = {}) => ({
  activateEntityTypePrompt: vi.fn(),
  assistEntityTypePrompt: vi.fn(),
  checkHealth: vi.fn(),
  createWorkspace: vi.fn(),
  deactivateEntityTypePrompt: vi.fn(),
  getAuthStatus: vi.fn(),
  getGraphEntityTypes: vi.fn(async () => []),
  getPopularLabels: vi.fn(async () => []),
  getWorkspaceOperation: vi.fn(),
  getWorkspaceStats: vi.fn(),
  hardDeleteWorkspace: vi.fn(),
  listEntityTypePrompts: vi.fn(),
  listWorkspaces: vi.fn(async () => ({ workspaces: [] })),
  loginAsGuest: vi.fn(),
  loginToServer: vi.fn(),
  readEntityTypePrompt: vi.fn(),
  restoreWorkspace: vi.fn(),
  saveEntityTypePromptVersion: vi.fn(),
  searchLabels: vi.fn(async () => []),
  softDeleteWorkspace: vi.fn(),
  validateEntityTypePrompt: vi.fn(),
  ...overrides
})
