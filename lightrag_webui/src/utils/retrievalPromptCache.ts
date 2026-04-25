import {
  getPromptConfigVersion,
  getPromptConfigVersions,
  type PromptVersionRecord,
  type PromptVersionRegistry
} from '@/api/lightrag'

const REGISTRY_TTL_MS = 30_000
const VERSION_TTL_MS = 5 * 60_000

type CacheEntry<T> = {
  value: T
  expiresAt: number
}

let registryCache: CacheEntry<PromptVersionRegistry> | null = null
const versionCache = new Map<string, CacheEntry<PromptVersionRecord>>()

const now = () => Date.now()

const isFresh = <T>(entry: CacheEntry<T> | null | undefined): entry is CacheEntry<T> =>
  !!entry && entry.expiresAt > now()

const cacheVersion = (version: PromptVersionRecord) => {
  versionCache.set(version.version_id, {
    value: version,
    expiresAt: now() + VERSION_TTL_MS
  })
}

const cacheRegistry = (registry: PromptVersionRegistry) => {
  registryCache = {
    value: registry,
    expiresAt: now() + REGISTRY_TTL_MS
  }
  registry.versions.forEach(cacheVersion)
}

export const clearRetrievalPromptCache = () => {
  registryCache = null
  versionCache.clear()
}

export const getCachedRetrievalPromptRegistry = async (
  forceRefresh: boolean = false
): Promise<PromptVersionRegistry> => {
  if (!forceRefresh && isFresh(registryCache)) {
    return registryCache.value
  }

  const registry = await getPromptConfigVersions('retrieval')
  cacheRegistry(registry)
  return registry
}

export const getCachedRetrievalPromptVersion = async (
  versionId: string,
  forceRefresh: boolean = false
): Promise<PromptVersionRecord> => {
  const cachedVersion = versionCache.get(versionId)
  if (!forceRefresh && isFresh(cachedVersion)) {
    return cachedVersion.value
  }

  if (!forceRefresh && isFresh(registryCache)) {
    const versionFromRegistry = registryCache.value.versions.find(
      (version) => version.version_id === versionId
    )
    if (versionFromRegistry) {
      cacheVersion(versionFromRegistry)
      return versionFromRegistry
    }
  }

  const version = await getPromptConfigVersion('retrieval', versionId)
  cacheVersion(version)
  return version
}

export const warmRetrievalPromptVersion = async (versionId: string): Promise<void> => {
  await getCachedRetrievalPromptVersion(versionId)
}
