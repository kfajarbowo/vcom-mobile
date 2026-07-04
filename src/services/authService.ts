import {apiRequestWithHeaders, saveSessionToken} from './apiClient';

export interface LoginCredentials {
  nrp: string;
  password: string;
}

export interface RegisterData {
  callsign: string;
  password: string;
  nrp: string;
  fullName?: string;
  rank?: string;
  branch?: string;
}

export interface User {
  id: number;
  callsign: string;
  fullName?: string;
  rank?: string;
  branch?: string;
  nrp?: string;
  role?: string;
}

export interface AuthResponse {
  user: User;
  sessionToken: string;
}

export const authService = {
  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    const {data: user, headers} = await apiRequestWithHeaders<User>(
      '/api/auth/login',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(credentials),
      },
    );

    // Extract session token from response header
    const sessionToken = headers.get('X-Session-Token');
    console.log('[Auth] Session token from header:', sessionToken);

    if (!sessionToken) {
      throw new Error('No session token received from server');
    }

    // Save session token
    await saveSessionToken(sessionToken);

    return {user, sessionToken};
  },

  async register(data: RegisterData): Promise<AuthResponse> {
    const {data: user, headers} = await apiRequestWithHeaders<User>(
      '/api/auth/register',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      },
    );

    // Extract session token from response header
    const sessionToken = headers.get('X-Session-Token');
    console.log('[Auth] Session token from header:', sessionToken);

    if (!sessionToken) {
      throw new Error('No session token received from server');
    }

    // Save session token
    await saveSessionToken(sessionToken);

    return {user, sessionToken};
  },
};
