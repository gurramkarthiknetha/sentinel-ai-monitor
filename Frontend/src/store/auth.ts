import { create } from 'zustand';

export type UserRole = 'admin' | 'operator' | 'responder';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar?: string;
}

interface AuthStore {
  user: User | null;
  setUser: (user: User | null) => void;
}

// Mock user for demo purposes
const mockUser: User = {
  id: '1',
  name: 'Alex Chen',
  email: 'alex@eventmonitor.ai',
  role: 'admin',
};

export const useAuthStore = create<AuthStore>((set) => ({
  user: mockUser,
  setUser: (user) => set({ user }),
}));
