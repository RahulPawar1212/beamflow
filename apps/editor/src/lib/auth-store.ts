import { create } from 'zustand';
import { api } from '../api/client';

export interface User {
  id: string;
  email: string;
  name: string;
}

interface AuthStoreState {
  token: string | null;
  user: User | null;
  loading: boolean;
  error: string | null;

  login: (email: string, password: string) => Promise<boolean>;
  register: (email: string, password: string, name: string) => Promise<boolean>;
  logout: () => void;
  clearError: () => void;
}

export const useAuthStore = create<AuthStoreState>((set) => {
  // Listen for 401 unauthorized events from the API client
  if (typeof window !== 'undefined') {
    window.addEventListener('bf-unauthorized', () => {
      set({ token: null, user: null, error: 'Session expired. Please sign in again.' });
    });
  }

  // Initial load
  const initialToken = localStorage.getItem('bf_token');
  const storedUser = localStorage.getItem('bf_user');
  const initialUser = storedUser ? JSON.parse(storedUser) : null;

  return {
    token: initialToken,
    user: initialUser,
    loading: false,
    error: null,

    login: async (email, password) => {
      set({ loading: true, error: null });
      try {
        const res = await api.login({ email, password });
        localStorage.setItem('bf_token', res.token);
        localStorage.setItem('bf_user', JSON.stringify(res.user));
        set({ token: res.token, user: res.user, loading: false });
        return true;
      } catch (err: any) {
        set({ error: err.message || 'Login failed', loading: false });
        return false;
      }
    },

    register: async (email, password, name) => {
      set({ loading: true, error: null });
      try {
        const res = await api.register({ email, password, name });
        localStorage.setItem('bf_token', res.token);
        localStorage.setItem('bf_user', JSON.stringify(res.user));
        set({ token: res.token, user: res.user, loading: false });
        return true;
      } catch (err: any) {
        set({ error: err.message || 'Registration failed', loading: false });
        return false;
      }
    },

    logout: () => {
      localStorage.removeItem('bf_token');
      localStorage.removeItem('bf_user');
      set({ token: null, user: null, error: null });
      window.location.reload();
    },

    clearError: () => set({ error: null }),
  };
});
