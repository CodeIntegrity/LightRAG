export type JwtPayload = {
  sub?: string
  role?: string
  exp?: number
  [key: string]: unknown
}

const normalizeBase64Url = (value: string): string => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const paddingLength = base64.length % 4

  if (paddingLength === 0) {
    return base64
  }

  return `${base64}${'='.repeat(4 - paddingLength)}`
}

export const parseJwtPayload = <T extends JwtPayload = JwtPayload>(
  token: string | null | undefined
): T | null => {
  if (!token) {
    return null
  }

  const parts = token.split('.')
  if (parts.length !== 3 || parts[1].length === 0) {
    return null
  }

  try {
    const decoded = atob(normalizeBase64Url(parts[1]))
    return JSON.parse(decoded) as T
  } catch {
    return null
  }
}

export const getJwtRole = (token: string | null | undefined): string | null =>
  parseJwtPayload(token)?.role ?? null
