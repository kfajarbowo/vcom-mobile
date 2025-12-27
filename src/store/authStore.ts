import {create} from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface User {
  id: number;
  username?: string;
  email?: string;
  callsign?: string;
  fullName?: string;
  role: string;
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
      set({sessionToken: token, isLoading: false});

      // If user has a stored session, connect to WebSocket
      if (token) {
        const {websocketService} = await import('../services/websocket');
        websocketService.connect().catch((error) => {
          console.error('[Auth] WebSocket connection error:', error);
        });
        console.log('[Auth] WebSocket connection initiated for stored session');
      }
    } catch (error) {
      console.error('Failed to initialize auth:', error);
      set({isLoading: false});
    }
  },
}));
