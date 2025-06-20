import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
  id: number;
  username: string;
  email: string;
  avatar?: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  loginStart: () => void;
  loginSuccess: (user: User, token: string) => void;
  loginFailure: (error: string) => void;
  registerStart: () => void;
  registerSuccess: () => void;
  registerFailure: (error: string) => void;
  logout: () => void;
  setUser: (user: User) => void;
  clearError: () => void;
  setToken: (token: string) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      loginStart: () => set({ isLoading: true, error: null }),
      loginSuccess: (user, token) => set({
        isLoading: false,
        isAuthenticated: true,
        user,
        token,
        error: null,
      }),
      loginFailure: (error) => set({ isLoading: false, error }),
      registerStart: () => set({ isLoading: true, error: null }),
      registerSuccess: () => set({ isLoading: false }),
      registerFailure: (error) => set({ isLoading: false, error }),
      logout: () => set({
        user: null,
        token: null,
        isAuthenticated: false,
        error: null,
      }),
      setUser: (user) => set({ user, isAuthenticated: true }),
      clearError: () => set({ error: null }),
      setToken: (token) => set({ token }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ token: state.token }),
    }
  )
); 