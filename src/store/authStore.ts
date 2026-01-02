import {create} from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface User {
  id: number;
  username?: string;
  email?: string;
  callsign?: string;
  fullName?: string;
  role?: string;
}

interface AuthState {
  user: User | null;
  sessionToken: string | null;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  setSessionToken: (token: string | null) => Promise<void>;
  logout: () => Promise<void>;
  initialize: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  sessionToken: null,
  isLoading: true,

  setUser: (user) => set({user}),

  setSessionToken: async (token) => {
    if (token) {
      await AsyncStorage.setItem('vcomm_session_token', token);
    } else {
      await AsyncStorage.removeItem('vcomm_session_token');
    }
    set({sessionToken: token});
  },

  logout: async () => {
    await AsyncStorage.removeItem('vcomm_session_token');
    set({user: null, sessionToken: null});

    // Disconnect WebSocket on logout
    const {websocketService} = await import('../services/websocket');
    websocketService.disconnect();
    console.log('[Auth] WebSocket disconnected on logout');
  },

  initialize: async () => {
    try {
      const token = await AsyncStorage.getItem('vcomm_session_token');

      if (token) {
        // Fetch user data from server to verify token and get user info
        try {
          const {apiRequest} = await import('../services/apiClient');
          const userData = await apiRequest<User>('/api/auth/user');
          console.log('[Auth] User data loaded:', userData);
          set({sessionToken: token, user: userData, isLoading: false});
        } catch (error) {
          console.error('[Auth] Failed to fetch user data, token may be invalid:', error);
          // Clear invalid token
          await AsyncStorage.removeItem('vcomm_session_token');
          set({sessionToken: null, user: null, isLoading: false});
        }
      } else {
        set({sessionToken: null, user: null, isLoading: false});
      }
    } catch (error) {
      console.error('[Auth] Failed to initialize auth:', error);
      set({isLoading: false});
    }
  },
}));
