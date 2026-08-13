import { afterEach, describe, expect, it, vi } from 'vitest'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()

  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

describe('home navigation persistence', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('restores the open direct message after a page reload', async () => {
    const storage = new MemoryStorage()
    vi.stubGlobal('localStorage', storage)

    const first = await import('../homeNavigationStore')
    first.useHomeNavigationStore.getState().setSelectedFriend(1, {
      id: 2,
      username: 'friend',
      email: 'friend@example.test',
    })

    vi.resetModules()
    const restored = await import('../homeNavigationStore')

    expect(restored.useHomeNavigationStore.getState().snapshots[1].selectedFriend?.id).toBe(2)
  })
})
