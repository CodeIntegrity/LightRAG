import React from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { toast } from 'sonner'

import en from '@/locales/en.json'

let capturedGuestLoginClick: (() => void | Promise<void>) | null = null

Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn()
  },
  configurable: true
})

Object.defineProperty(globalThis, 'sessionStorage', {
  value: {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn()
  },
  configurable: true
})

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      options?: string | { defaultValue?: string; [key: string]: string | number | undefined }
    ) => {
      const translated = key.split('.').reduce<unknown>((current, segment) => {
        if (current && typeof current === 'object') {
          return (current as Record<string, unknown>)[segment]
        }
        return undefined
      }, en as Record<string, unknown>)
      if (typeof translated === 'string') {
        if (!options || typeof options === 'string') {
          return translated
        }
        return translated.replace(/\{\{(\w+)\}\}/g, (_, token) =>
          String(options[token] ?? '')
        )
      }
      if (typeof options === 'string') {
        return options
      }
      return options?.defaultValue || key
    }
  })
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn()
  }
}))

vi.mock('@/components/ui/Button', () => ({
  default: ({
    children,
    onClick,
    ...props
  }: {
    children: React.ReactNode
    onClick?: () => void | Promise<void>
  }) => {
    const text = React.Children.toArray(children).join('')
    if (typeof onClick === 'function' && text.includes('Continue as guest')) {
      capturedGuestLoginClick = onClick
    }
    return <button onClick={onClick} {...props}>{children}</button>
  }
}))

vi.mock('@/components/ui/Card', () => ({
  Card: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  CardContent: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  CardDescription: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  CardHeader: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  CardTitle: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  )
}))

vi.mock('@/components/ui/Input', () => ({
  default: (props: Record<string, unknown>) => <input {...props} />
}))

vi.mock('@/components/AppSettings', () => ({
  default: ({ className }: { className?: string }) => <div className={className}>settings</div>
}))

vi.mock('lucide-react', () => ({
  ZapIcon: ({ className }: { className?: string }) => <div className={className}>zap</div>
}))

vi.mock('@/api/lightrag', () => ({
  checkHealth: vi.fn(),
  getAuthStatus: vi.fn(),
  loginToServer: vi.fn(),
  loginAsGuest: vi.fn()
}))

const loginMock = vi.fn()
const logoutMock = vi.fn()

afterEach(async () => {
  vi.clearAllMocks()
  capturedGuestLoginClick = null
  const { useAuthStore } = await import('@/stores/state')
  useAuthStore.setState({
    isAuthenticated: false,
    isGuestMode: false,
    username: null,
    login: loginMock,
    logout: logoutMock
  } as never)
})

describe('LoginPage', () => {
  test('renders guest login entry when backend capability allows it', async () => {
    const { useAuthStore } = await import('@/stores/state')
    useAuthStore.setState({
      isAuthenticated: false,
      login: loginMock,
      logout: logoutMock
    } as never)

    const ReactModule = await import('react')
    const actualUseState = ReactModule.useState
    const noop = () => undefined

    vi.spyOn(ReactModule, 'useState')
      .mockImplementationOnce((() => [false, noop]) as never)
      .mockImplementationOnce((() => ['', noop]) as never)
      .mockImplementationOnce((() => ['', noop]) as never)
      .mockImplementationOnce((() => [false, noop]) as never)
      .mockImplementationOnce((() => [true, noop]) as never)
      .mockImplementation(actualUseState as never)

    const module = await import('./LoginPage')
    const html = renderToString(<module.default />)

    expect(html).toContain('Continue as guest')
  })

  test('clicking guest login entry uses guest token flow', async () => {
    const { useAuthStore } = await import('@/stores/state')
    const { useSettingsStore } = await import('@/stores/settings')
    useAuthStore.setState({
      isAuthenticated: false,
      login: loginMock,
      logout: logoutMock
    } as never)

    const api = await import('@/api/lightrag')
    const loginAsGuestMock = api.loginAsGuest as unknown as ReturnType<typeof vi.fn>
    loginAsGuestMock.mockResolvedValue({
      access_token: 'guest-token',
      token_type: 'bearer',
      auth_mode: 'guest',
      message: 'Guest access enabled.',
      core_version: '1.0.0',
      api_version: '1.0.0'
    })

    const setRetrievalHistorySpy = vi.spyOn(useSettingsStore.getState(), 'setRetrievalHistory')
    const clearWorkspaceDisplayNamesSpy = vi.spyOn(
      useSettingsStore.getState(),
      'clearWorkspaceDisplayNames'
    )

    const ReactModule = await import('react')
    const actualUseState = ReactModule.useState
    const noop = () => undefined

    vi.spyOn(ReactModule, 'useState')
      .mockImplementationOnce((() => [false, noop]) as never)
      .mockImplementationOnce((() => ['', noop]) as never)
      .mockImplementationOnce((() => ['', noop]) as never)
      .mockImplementationOnce((() => [false, noop]) as never)
      .mockImplementationOnce((() => [true, noop]) as never)
      .mockImplementation(actualUseState as never)

    const module = await import('./LoginPage')
    renderToString(<module.default />)

    expect(capturedGuestLoginClick).not.toBeNull()
    await capturedGuestLoginClick?.()

    const tokenSetCalls = (localStorage.setItem as unknown as ReturnType<typeof vi.fn>).mock.calls
    expect(loginAsGuestMock).toHaveBeenCalledTimes(1)
    expect(tokenSetCalls.some((call) => call[0] === 'LIGHTRAG-API-TOKEN' && call[1] === 'guest-token')).toBe(true)
    expect(useAuthStore.getState().isGuestMode).toBe(true)
    expect(setRetrievalHistorySpy).toHaveBeenCalled()
    expect(clearWorkspaceDisplayNamesSpy).toHaveBeenCalled()
    expect(toast.info).toHaveBeenCalled()
  })
})
