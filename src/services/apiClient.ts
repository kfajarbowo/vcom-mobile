/**
 * API Client utilities for VComm Mobile
 * Platform-agnostic API client that works with AsyncStorage
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import RNFetchBlob from 'rn-fetch-blob';
import { Platform, Linking, Share, NativeModules } from 'react-native';
import FileViewer from 'react-native-file-viewer';

const { FileOpener } = NativeModules;

// Storage keys
export const STORAGE_KEYS = {
  SESSION_TOKEN: 'vcomm_session_token',
  SERVER_HOST: 'vcomm_server_host',
  SERVER_PORT: 'vcomm_server_port',
  USER_DATA: 'vcomm_user_data',
  LICENSE_KEY: 'vcomm_license_key',
  LICENSE_SERVER_HOST: 'vcomm_license_server_host',
  LICENSE_SERVER_PORT: 'vcomm_license_server_port',
} as const;

/**
 * Get base API URL
 */
export const getApiBaseUrl = async (): Promise<string> => {
  const protocol = 'http';
  let host = 'chat.id';
  let port = '5000';

  try {
    const storedHost = await AsyncStorage.getItem(STORAGE_KEYS.SERVER_HOST);
    const storedPort = await AsyncStorage.getItem(STORAGE_KEYS.SERVER_PORT);

    if (storedHost) host = storedHost;
    if (storedPort) port = storedPort;
  } catch (error) {
    console.error('[API] Error reading server config from storage:', error);
  }

  console.log(`[API] Using server: ${protocol}://${host}:${port}`);

  return `${protocol}://${host}:${port}`;
};

/**
 * Set API server configuration
 */
export const setApiServer = async (host: string, port: string): Promise<void> => {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.SERVER_HOST, host);
    await AsyncStorage.setItem(STORAGE_KEYS.SERVER_PORT, port);
  } catch (error) {
    console.error('[API] Error saving server config to storage:', error);
  }
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

  // Add timeout handling
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

  try {
    console.log('[API] Sending network request...');
    const response = await fetch(url, {
      ...options,
      headers,
      credentials: 'include', // Important for session cookies
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    console.log(`[API] Response received: ${response.status}`);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    console.error(`[API] Fetch error for ${url}:`, error);
    throw error;
  }
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
): Promise<{ data: T; headers: Headers }> => {
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
  return { data, headers: response.headers };
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

/**
 * Download and open a PDF file with authentication
 */
export const downloadAndOpenPDF = async (
  fileUrl: string,
  fileName: string,
): Promise<void> => {
  try {
    console.log('[API] Downloading PDF:', fileUrl);

    // Get session token
    const sessionToken = await getSessionToken();

    // Prepare headers
    const headers: Record<string, string> = {
      'X-Session-Token': sessionToken || '',
    };

    // Configure download - use cache directory for better Android compatibility
    const { config, fs, android, ios } = RNFetchBlob;

    // For Android, use cache directory to avoid scoped storage issues
    // For iOS, use documents directory
    const downloadDir = Platform.OS === 'ios' ? fs.dirs.DocumentDir : fs.dirs.CacheDir;

    // Ensure filename ends with .pdf extension
    const sanitizedFileName = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
    const filePath = `${downloadDir}/${sanitizedFileName}`;

    console.log('[API] Downloading to:', filePath);

    // Download file with authentication
    const response = await config({
      fileCache: true,
      path: filePath,
    }).fetch('GET', fileUrl, headers);

    const downloadedPath = response.path();
    console.log('[API] Download complete:', downloadedPath);

    // Verify the file was downloaded successfully
    const fileExists = await fs.exists(downloadedPath);
    console.log('[API] File exists:', fileExists);

    if (!fileExists) {
      throw new Error('File download failed - file does not exist');
    }

    // Check file size to ensure it's not empty or an error page
    const stat = await fs.stat(downloadedPath);
    console.log('[API] File size:', stat.size, 'bytes');

    // if (stat.size < 100) {
    //   throw new Error('Downloaded file is too small - might be an error response');
    // }

    // Open the file with system PDF viewer
    if (Platform.OS === 'android') {
      try {
        console.log('[API] Opening PDF with custom FileOpener module...');

        // Use our custom native module with proper FileProvider support
        await FileOpener.openFile(downloadedPath, 'application/pdf');

        console.log('[API] FileOpener succeeded - "Open with" dialog should appear');
      } catch (openerError: any) {
        console.error('[API] FileOpener failed:', openerError);

        // Fallback: Try using RNFetchBlob's actionViewIntent
        try {
          console.log('[API] Trying RNFetchBlob Intent as fallback...');
          await android.actionViewIntent(downloadedPath, 'application/pdf');
          console.log('[API] Intent sent');
        } catch (intentError: any) {
          console.error('[API] Intent also failed:', intentError);
          throw new Error('Unable to open PDF. Please install a PDF viewer like Adobe Acrobat Reader, Google PDF Viewer, or Chrome from the Play Store.');
        }
      }
    } else {
      // iOS
      try {
        console.log('[API] Opening PDF on iOS...');
        await ios.openDocument(downloadedPath);
        console.log('[API] Successfully opened PDF on iOS');
      } catch (iosError) {
        console.error('[API] iOS openDocument failed:', iosError);
        throw new Error('Failed to open PDF. Please ensure you have a PDF viewer app installed.');
      }
    }
  } catch (error: any) {
    console.error('[API] Failed to download/open PDF:', error);

    // Provide more helpful error messages
    if (error.message?.includes('No Activity found') || error.message?.includes('No PDF viewer')) {
      throw new Error('No PDF viewer app found. Please install a PDF viewer from the Play Store.');
    } else if (error.message?.includes('Permission denied') || error.message?.includes('EACCES')) {
      throw new Error('Permission denied. Please grant storage permissions in Settings.');
    } else if (error.message?.includes('Network') || error.message?.includes('timeout')) {
      throw new Error('Network error. Please check your connection and try again.');
    } else {
      throw error;
    }
  }
};

/**
 * Get MIME type based on file extension
 */
const getMimeType = (fileName: string): string => {
  const ext = fileName.toLowerCase().split('.').pop();
  const mimeTypes: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    csv: 'text/csv',
  };
  return mimeTypes[ext || ''] || 'application/octet-stream';
};

/**
 * Download and open a document file with authentication (supports PDF, Word, Excel, PowerPoint, etc.)
 */
export const downloadAndOpenDocument = async (
  fileUrl: string,
  fileName: string,
): Promise<void> => {
  try {
    console.log('[API] Downloading document:', fileUrl, fileName);

    // Get session token
    const sessionToken = await getSessionToken();

    // Prepare headers
    const headers: Record<string, string> = {
      'X-Session-Token': sessionToken || '',
    };

    // Configure download - use cache directory for better Android compatibility
    const { config, fs, android, ios } = RNFetchBlob;

    // For Android, use cache directory to avoid scoped storage issues
    // For iOS, use documents directory
    const downloadDir = Platform.OS === 'ios' ? fs.dirs.DocumentDir : fs.dirs.CacheDir;
    const filePath = `${downloadDir}/${fileName}`;

    console.log('[API] Downloading to:', filePath);

    // Download file with authentication
    const response = await config({
      fileCache: true,
      path: filePath,
    }).fetch('GET', fileUrl, headers);

    const downloadedPath = response.path();
    console.log('[API] Download complete:', downloadedPath);

    // Verify the file was downloaded successfully
    const fileExists = await fs.exists(downloadedPath);
    console.log('[API] File exists:', fileExists);

    if (!fileExists) {
      throw new Error('File download failed - file does not exist');
    }

    // Check file size to ensure it's not empty or an error page
    const stat = await fs.stat(downloadedPath);
    console.log('[API] File size:', stat.size, 'bytes');

    // if (stat.size < 100) {
    //   throw new Error('Downloaded file is too small - might be an error response');
    // }

    // Get MIME type based on file extension
    const mimeType = getMimeType(fileName);
    console.log('[API] MIME type:', mimeType);

    // Open the file with system viewer
    if (Platform.OS === 'android') {
      try {
        console.log('[API] Opening document with custom FileOpener module...');

        // Use our custom native module with proper FileProvider support
        await FileOpener.openFile(downloadedPath, mimeType);

        console.log('[API] FileOpener succeeded - "Open with" dialog should appear');
      } catch (openerError: any) {
        console.error('[API] FileOpener failed:', openerError);

        // Fallback: Try using RNFetchBlob's actionViewIntent
        try {
          console.log('[API] Trying RNFetchBlob Intent as fallback...');
          await android.actionViewIntent(downloadedPath, mimeType);
          console.log('[API] Intent sent');
        } catch (intentError: any) {
          console.error('[API] Intent also failed:', intentError);
          throw new Error(`Unable to open document. Please install an app that can open ${fileName.split('.').pop()?.toUpperCase()} files.`);
        }
      }
    } else {
      // iOS
      try {
        console.log('[API] Opening document on iOS...');
        await ios.openDocument(downloadedPath);
        console.log('[API] Successfully opened document on iOS');
      } catch (iosError) {
        console.error('[API] iOS openDocument failed:', iosError);
        throw new Error(`Failed to open document. Please ensure you have an app installed that can open ${fileName.split('.').pop()?.toUpperCase()} files.`);
      }
    }
  } catch (error: any) {
    console.error('[API] Failed to download/open document:', error);

    // Provide more helpful error messages
    if (error.message?.includes('No Activity found')) {
      throw new Error('No suitable app found to open this document. Please install an appropriate viewer app.');
    } else if (error.message?.includes('Permission denied') || error.message?.includes('EACCES')) {
      throw new Error('Permission denied. Please grant storage permissions in Settings.');
    } else if (error.message?.includes('Network') || error.message?.includes('timeout')) {
      throw new Error('Network error. Please check your connection and try again.');
    } else {
      throw error;
    }
  }
};
