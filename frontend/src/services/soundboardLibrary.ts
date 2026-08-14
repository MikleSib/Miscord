const KEY = 'miscord:soundboard-library:v1'
const MAX_RECENT = 50

export interface SoundUsage {
  count: number
  lastUsed: number
}

export interface SoundboardLibraryState {
  favorites: number[]
  usage: Record<number, SoundUsage>
}

const emptyState = (): SoundboardLibraryState => ({ favorites: [], usage: {} })

export function getSoundboardLibrary(): SoundboardLibraryState {
  if (typeof window === 'undefined') return emptyState()
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || '{}')
    return {
      favorites: Array.isArray(stored.favorites)
        ? stored.favorites.filter(Number.isInteger).slice(0, MAX_RECENT)
        : [],
      usage: stored.usage && typeof stored.usage === 'object' ? stored.usage : {},
    }
  } catch {
    return emptyState()
  }
}

function save(state: SoundboardLibraryState): SoundboardLibraryState {
  if (typeof window !== 'undefined') localStorage.setItem(KEY, JSON.stringify(state))
  return state
}

export function toggleFavorite(soundId: number): SoundboardLibraryState {
  const current = getSoundboardLibrary()
  const favorites = current.favorites.includes(soundId)
    ? current.favorites.filter((id) => id !== soundId)
    : [soundId, ...current.favorites].slice(0, MAX_RECENT)
  return save({ ...current, favorites })
}

export function recordSoundUse(soundId: number): SoundboardLibraryState {
  const current = getSoundboardLibrary()
  const previous = current.usage[soundId]
  const usage = {
    ...current.usage,
    [soundId]: { count: (previous?.count || 0) + 1, lastUsed: Date.now() },
  }
  const retained = Object.entries(usage)
    .sort(([, a], [, b]) => b.lastUsed - a.lastUsed)
    .slice(0, MAX_RECENT)
  return save({ ...current, usage: Object.fromEntries(retained) })
}

export function frequentSoundIds(state: SoundboardLibraryState, limit = 9): number[] {
  return Object.entries(state.usage)
    .sort(([, a], [, b]) => b.count - a.count || b.lastUsed - a.lastUsed)
    .slice(0, limit)
    .map(([id]) => Number(id))
}
