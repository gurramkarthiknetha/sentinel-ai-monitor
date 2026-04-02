import { create } from 'zustand';

export type UserRole = 'admin' | 'operator' | 'responder';
export type ResponderType = 'medical' | 'fire' | 'crowd' | 'inactivity';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

const AUTH_TOKEN_STORAGE_KEY = 'sentinel.auth.token';

const readStoredToken = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  const token = window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  return token && token.trim() ? token : null;
};

const persistToken = (token: string | null) => {
  if (typeof window === 'undefined') {
    return;
  }

  if (token) {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  } else {
    window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  }
};

export interface AuthUser {
  id: string;
  googleId: string;
  name: string;
  email: string;
  approvalStatus: ApprovalStatus;
  role: UserRole;
  responderType?: ResponderType | null;
  avatar?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface AuthStore {
  user: AuthUser | null;
  token: string | null;
  isBootstrapping: boolean;
  setUser: (user: AuthUser | null) => void;
  setBootstrapping: (value: boolean) => void;
  setSession: (payload: { token: string; user: AuthUser }) => void;
  clearSession: () => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  token: readStoredToken(),
  isBootstrapping: true,
  setUser: (user) => set({ user }),
  setBootstrapping: (value) => set({ isBootstrapping: value }),
  setSession: ({ token, user }) => {
    persistToken(token);
    set({ token, user });
  },
  clearSession: () => {
    persistToken(null);
    set({ token: null, user: null, isBootstrapping: false });
  },
}));

export const getAuthToken = () => useAuthStore.getState().token;
