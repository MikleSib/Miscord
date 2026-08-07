import { create } from 'zustand';

export type StreamerInfo = {
  userId: number;
  username: string;
  avatar_url?: string;
};

interface ScreenShareState {
  streamers: StreamerInfo[];
  viewerOpen: boolean;
  activeStreamerId: number | null;
  addStreamer: (streamer: StreamerInfo) => void;
  removeStreamer: (userId: number) => void;
  openViewer: (userId: number, username?: string) => void;
  closeViewer: () => void;
}

export const useScreenShareStore = create<ScreenShareState>((set, get) => ({
  streamers: [],
  viewerOpen: false,
  activeStreamerId: null,

  addStreamer: (streamer) => {
    set((state) => {
      if (state.streamers.some((s) => s.userId === streamer.userId)) {
        return state;
      }
      return { streamers: [...state.streamers, streamer] };
    });
  },

  removeStreamer: (userId) => {
    set((state) => {
      const streamers = state.streamers.filter((s) => s.userId !== userId);
      const viewerOpen =
        state.viewerOpen && state.activeStreamerId === userId ? false : state.viewerOpen;
      const activeStreamerId =
        state.activeStreamerId === userId ? null : state.activeStreamerId;
      return { streamers, viewerOpen, activeStreamerId };
    });
  },

  openViewer: (userId, username) => {
    const { streamers } = get();
    if (!streamers.some((s) => s.userId === userId) && username) {
      get().addStreamer({ userId, username });
    }
    set({ viewerOpen: true, activeStreamerId: userId });
  },

  closeViewer: () => {
    set({ viewerOpen: false });
  },
}));
