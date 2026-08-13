import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getFullServerData: vi.fn(),
  getChannelDetails: vi.fn(),
}))

vi.mock('../../services/channelService', () => ({
  default: {
    getFullServerData: mocks.getFullServerData,
    getChannelDetails: mocks.getChannelDetails,
  },
}))
vi.mock('../../services/uploadService', () => ({ default: { uploadFile: vi.fn() } }))
vi.mock('../../services/chatService', () => ({
  default: { connect: vi.fn(), disconnect: vi.fn(), sendMessage: vi.fn(), sendTyping: vi.fn() },
}))
vi.mock('../../store/dmNotificationStore', () => ({
  useDmNotificationStore: { getState: () => ({ clearAll: vi.fn() }) },
}))
vi.mock('../../store/channelUnreadStore', () => ({
  useChannelUnreadStore: { getState: () => ({
    setViewingTextChannelId: vi.fn(),
    markChannelRead: vi.fn(),
  }) },
}))
vi.mock('../../store/store', () => ({
  useAuthStore: { getState: () => ({ token: null }) },
}))
vi.mock('../appStoreRealtime', () => ({
  initializeAppRealtime: vi.fn(),
  disconnectAppRealtime: vi.fn(),
}))

import { useStore } from '../store'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const fullServer = (id: number, name: string) => ({
  id,
  name,
  description: undefined,
  icon: undefined,
  owner_id: 1,
  created_at: '2026-08-13T00:00:00Z',
  text_channels: [],
  voice_channels: [],
})

describe('app navigation restoration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useStore.setState({
      servers: [],
      currentServer: null,
      currentChannel: null,
      isLoading: false,
      error: null,
      appView: 'home',
    })
  })

  it('keeps Home selected when the server bootstrap finishes later', async () => {
    const response = deferred<{ servers: ReturnType<typeof fullServer>[] }>()
    mocks.getFullServerData.mockReturnValue(response.promise)

    const loading = useStore.getState().loadServers()
    await useStore.getState().selectServer(0)
    response.resolve({ servers: [fullServer(1, 'Первый сервер')] })
    await loading

    expect(useStore.getState().appView).toBe('home')
    expect(useStore.getState().currentServer).toBeNull()
    expect(mocks.getChannelDetails).not.toHaveBeenCalled()
  })

  it('restores the selected server only when the saved view is a server', async () => {
    const cached = { ...fullServer(7, 'Кеш'), channels: [] }
    useStore.setState({ servers: [cached], currentServer: cached, appView: 'server' })
    mocks.getFullServerData.mockResolvedValue({ servers: [fullServer(7, 'Обновлён')] })
    mocks.getChannelDetails.mockResolvedValue({
      ...fullServer(7, 'Обновлён'),
      channels: [],
      members: [],
    })

    await useStore.getState().loadServers()

    expect(useStore.getState().appView).toBe('server')
    expect(useStore.getState().currentServer?.id).toBe(7)
    expect(mocks.getChannelDetails).toHaveBeenCalledWith(7)
  })
})
