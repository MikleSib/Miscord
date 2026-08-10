import { create } from 'zustand'

interface MentionIntent {
  id: number
  channelId: number
  userId: number
}

interface ChatComposerIntentState {
  nextId: number
  mention: MentionIntent | null
  queueMention: (channelId: number, userId: number) => void
  consumeMention: (id: number) => void
}

export const useChatComposerIntentStore = create<ChatComposerIntentState>((set) => ({
  nextId: 1,
  mention: null,
  queueMention: (channelId, userId) => set((state) => ({
    nextId: state.nextId + 1,
    mention: { id: state.nextId, channelId, userId },
  })),
  consumeMention: (id) => set((state) => (
    state.mention?.id === id ? { mention: null } : state
  )),
}))
