import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface User {
  id: number;
  username?: string;
  email?: string;
  callsign?: string;
  fullName?: string;
  nrp?: string;
  rank?: string;
  branch?: string;
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

  setUser: (user) => set({ user }),

  setSessionToken: async (token) => {
    if (token) {
      await AsyncStorage.setItem('vcomm_session_token', token);
    } else {
      await AsyncStorage.removeItem('vcomm_session_token');
    }
    set({ sessionToken: token });
  },

  logout: async () => {
    // Tear down any in-progress call FIRST. The call UI is only mounted while a session exists,
    // so clearing the token unmounts it mid-call — without this the RTCPeerConnection, captured
    // mic/camera, and audio session keep running with no hang-up UI, and the store stays 'active'
    // so every future incoming call is busy-rejected after re-login.
    try {
      const { useCallStore } = await import('./callStore');
      const callState = useCallStore.getState();
      if (callState.status !== 'idle') {
        console.log('[Auth] Ending in-progress call before logout, status:', callState.status);
        const { webrtcService } = await import('../services/webrtcService');
        if (callState.isGroupCall) {
          webrtcService.endGroupCall();
        } else {
          webrtcService.endCall();
        }
      }
    } catch (error) {
      console.error('[Auth] Error tearing down call on logout:', error);
    }

    await AsyncStorage.removeItem('vcomm_session_token');
    set({ user: null, sessionToken: null });

    // Disconnect WebSocket on logout
    const { websocketService } = await import('../services/websocket');
    websocketService.disconnect();
    console.log('[Auth] WebSocket disconnected on logout');
  },

  initialize: async () => {
    try {
      const token = await AsyncStorage.getItem('vcomm_session_token');

      if (token) {
        // Fetch user data from server to verify token and get user info
        try {
          const { apiRequest } = await import('../services/apiClient');
          const userData = await apiRequest<User>('/api/auth/user');
          console.log('[Auth] User data loaded:', userData);
          set({ sessionToken: token, user: userData, isLoading: false });
        } catch (error) {
          console.error('[Auth] Failed to fetch user data. Error details:', error);
          const errorMessage = error instanceof Error ? error.message : String(error);

          if (errorMessage.includes('Aborted') || errorMessage.includes('Network request failed')) {
            console.log('[Auth] Network timeout or error. Logging out to prevent hang.');
          }

          // Clear invalid token
          await AsyncStorage.removeItem('vcomm_session_token');
          set({ sessionToken: null, user: null, isLoading: false });
        }
      } else {
        set({ sessionToken: null, user: null, isLoading: false });
      }
    } catch (error) {
      console.error('[Auth] Failed to initialize auth:', error);
      set({ isLoading: false });
    }
  },
}));
