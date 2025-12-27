/**
 * API Client utilities for VComm Mobile
 * Platform-agnostic API client that works with AsyncStorage
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// Storage keys
export const STORAGE_KEYS = {
  SESSION_TOKEN: 'vcomm_session_token',
  SERVER_HOST: 'vcomm_server_host',
  SERVER_PORT: 'vcomm_server_port',
  USER_DATA: 'vcomm_user_data',
} as const;

/**
 * Get base API URL from storage or use default
 */
export const getApiBaseUrl = async (): Promise<string> => {
  // const host = (await AsyncStorage.getItem(STORAGE_KEYS.SERVER_HOST)) || '31.97.50.227';
  const host = '31.97.50.227';
  const port = '5000';

  // const port = (await AsyncStorage.getItem(STORAGE_KEYS.SERVER_PORT)) || '5000';

  // Use HTTP for now (can switch to HTTPS later)
  const protocol = 'http';

  return `${protocol}://${host}:${port}`;
};

/**
 * Set API server configuration
 */
export const setApiServer = async (host: string, port: string): Promise<void> => {
  await AsyncStorage.setItem(STORAGE_KEYS.SERVER_HOST, host);
  await AsyncStorage.setItem(STORAGE_KEYS.SERVER_PORT, port);
};

/**
 * Fetch wrapper with automatic base URL injection and session token handling
 */
export const apiFetch = async (
  endpoint: string,
  options?: RequestInit,
): Promise<Response> => {
  const baseUrl = await getApiBaseUrl();
  const url = endpoint.startsWith('/') ? `${baseUrl}${endpoint}` : `${baseUrl}/${endpoint}`;

  console.log(`[API] Fetching: ${url}`);

  // Get session token from storage
  const sessionToken = await AsyncStorage.getItem(STORAGE_KEYS.SESSION_TOKEN);

  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string> || {}),
  };

  // Send session token via header for authentication
  if (sessionToken) {
    headers['X-Session-Token'] = sessionToken;
    console.log(`[API] Added X-Session-Token header`);
  }

  return fetch(url, {
    ...options,
    headers,
    credentials: 'include', // Important for session cookies
  });
};

/**
 * Type-safe API fetch with JSON response
 */
export const apiRequest = async <T = any>(
  endpoint: string,
  options?: RequestInit,
): Promise<T> => {
  const response = await apiFetch(endpoint, options);

  if (!response.ok) {
    let errorMessage = `Request failed: ${response.status}`;
    try {
      const errorData = await response.json();
      errorMessage = errorData.message || errorMessage;
    } catch {
      errorMessage = response.statusText || errorMessage;
    }
    throw new Error(errorMessage);
  }

  return response.json();
};

/**
 * API fetch that returns both response data and headers
 * Used for login/register to extract session token from header
 */
export const apiRequestWithHeaders = async <T = any>(
  endpoint: string,
  options?: RequestInit,
): Promise<{data: T; headers: Headers}> => {
  const response = await apiFetch(endpoint, options);

  if (!response.ok) {
    let errorMessage = `Request failed: ${response.status} ${response.statusText}`;
    try {
      const errorData = await response.json();
      console.error('[API] Error response:', errorData);
      errorMessage = errorData.message || errorMessage;
    } catch (parseError) {
      console.error('[API] Could not parse error response');
      errorMessage = response.statusText || errorMessage;
    }
    console.error('[API] Final error message:', errorMessage);
    throw new Error(errorMessage);
  }

  const data = await response.json();
  console.log('[API] Success response received');
  return {data, headers: response.headers};
};

/**
 * Save session token to storage
 */
export const saveSessionToken = async (token: string): Promise<void> => {
  await AsyncStorage.setItem(STORAGE_KEYS.SESSION_TOKEN, token);
};

/**
 * Get session token from storage
 */
export const getSessionToken = async (): Promise<string | null> => {
  return await AsyncStorage.getItem(STORAGE_KEYS.SESSION_TOKEN);
};

/**
 * Clear session token from storage
 */
export const clearSessionToken = async (): Promise<void> => {
  await AsyncStorage.removeItem(STORAGE_KEYS.SESSION_TOKEN);
};
