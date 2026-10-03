'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  hospitalId: string | null;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  status: 'idle' | 'loading' | 'authenticated' | 'unauthenticated';
  setSession: (user: AuthUser, accessToken: string) => void;
  clearSession: () => void;
  setStatus: (status: AuthState['status']) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      status: 'idle',
      setSession: (user, accessToken) => set({ user, accessToken, status: 'authenticated' }),
      clearSession: () => set({ user: null, accessToken: null, status: 'unauthenticated' }),
      setStatus: (status) => set({ status }),
    }),
    { name: 'medcore-auth', partialize: (state) => ({ user: state.user, accessToken: state.accessToken, status: state.status }) },
  ),
);
