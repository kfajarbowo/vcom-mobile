/**
 * Cross-platform call notification service
 * Handles incoming call notifications for both Android and iOS
 */

import {
  NativeModules,
  NativeEventEmitter,
  Platform,
  AppRegistry,
  EmitterSubscription,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { IncomingCallData, CallActionEvent } from '../types/native';
import { gotifyClientService } from './gotifyClientService';

// Get the appropriate native module based on platform
const CallNotificationNative = Platform.select({
  ios: NativeModules.CallKitModule,
  android: NativeModules.CallNotificationModule,
});

// Storage keys
const GOTIFY_URL_KEY = '@gotify_url';
const GOTIFY_TOKEN_KEY = '@gotify_client_token';
const SERVICE_ENABLED_KEY = '@gotify_service_enabled';

// Event types
type CallActionCallback = (event: CallActionEvent) => void;
type IncomingCallCallback = (data: IncomingCallData) => void;

class CallNotificationService {
  private static instance: CallNotificationService;
  private eventEmitter: NativeEventEmitter | null = null;
  private callActionSubscription: EmitterSubscription | null = null;
  private incomingCallSubscription: EmitterSubscription | null = null;
  private callActionCallbacks: Set<CallActionCallback> = new Set();
  private incomingCallCallbacks: Set<IncomingCallCallback> = new Set();
  private isInitialized = false;

  private constructor() {}

  static getInstance(): CallNotificationService {
    if (!CallNotificationService.instance) {
      CallNotificationService.instance = new CallNotificationService();
    }
    return CallNotificationService.instance;
  }

  /**
   * Initialize the notification service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log('[CallNotificationService] Already initialized');
      return;
    }

    try {
      console.log('[CallNotificationService] Initializing...');

      // Setup native event emitter
      if (CallNotificationNative) {
        this.eventEmitter = new NativeEventEmitter(CallNotificationNative);
        this.setupEventListeners();
      }

      // Register HeadlessJS task for Android background handling
      if (Platform.OS === 'android') {
        this.registerHeadlessTask();
      }

      // Request notification permission on Android 13+
      await this.requestPermission();

      // Start Gotify service if configured
      await this.startGotifyServiceIfConfigured();

      this.isInitialized = true;
      console.log('[CallNotificationService] Initialized successfully');
    } catch (error) {
      console.error('[CallNotificationService] Initialization error:', error);
    }
  }

  /**
   * Setup event listeners for native module events
   */
  private setupEventListeners(): void {
    if (!this.eventEmitter) return;

    // Listen for call action events (accept/reject from notification)
    this.callActionSubscription = this.eventEmitter.addListener(
      'onCallAction',
      (event: CallActionEvent) => {
        console.log('[CallNotificationService] Call action:', event);
        this.callActionCallbacks.forEach(callback => callback(event));
      }
    );

    // Listen for incoming call events (from Gotify service)
    this.incomingCallSubscription = this.eventEmitter.addListener(
      'onIncomingCall',
      (data: IncomingCallData) => {
        console.log('[CallNotificationService] Incoming call:', data);
        this.incomingCallCallbacks.forEach(callback => callback(data));
      }
    );
  }

  /**
   * Register HeadlessJS task for Android background call handling
   */
  private registerHeadlessTask(): void {
    AppRegistry.registerHeadlessTask('CallBackgroundTask', () => async (data) => {
      console.log('[CallNotificationService] HeadlessJS task received:', data);
      // This task handles call rejection when app is killed
      // The actual rejection is handled by the callback registered via addCallActionListener
      this.callActionCallbacks.forEach(callback => callback(data as CallActionEvent));
    });
  }

  /**
   * Request notification permission (Android 13+)
   */
  async requestPermission(): Promise<boolean> {
    try {
      if (!CallNotificationNative) return false;

      const result = await CallNotificationNative.requestNotificationPermission();
      console.log('[CallNotificationService] Permission result:', result);
      return result === 'granted' || result === 'not_required';
    } catch (error) {
      console.error('[CallNotificationService] Permission error:', error);
      return false;
    }
  }

  /**
   * Check notification permission
   */
  async checkPermission(): Promise<boolean> {
    try {
      if (!CallNotificationNative) return false;
      return await CallNotificationNative.checkNotificationPermission();
    } catch (error) {
      console.error('[CallNotificationService] Check permission error:', error);
      return false;
    }
  }

  /**
   * Show incoming call notification
   */
  async showIncomingCallNotification(data: IncomingCallData): Promise<boolean> {
    try {
      if (!CallNotificationNative) {
        console.warn('[CallNotificationService] Native module not available');
        return false;
      }

      console.log('[CallNotificationService] Showing notification:', data);

      return await CallNotificationNative.showIncomingCallNotification(
        data.callId,
        data.callerId,
        data.callerName,
        data.callType,
        data.isGroupCall
      );
    } catch (error) {
      console.error('[CallNotificationService] Show notification error:', error);
      return false;
    }
  }

  /**
   * Cancel/dismiss incoming call notification
   */
  async cancelCallNotification(): Promise<boolean> {
    try {
      if (!CallNotificationNative) return false;
      return await CallNotificationNative.cancelCallNotification();
    } catch (error) {
      console.error('[CallNotificationService] Cancel notification error:', error);
      return false;
    }
  }

  /**
   * Report call ended (iOS CallKit)
   */
  async reportCallEnded(): Promise<void> {
    if (Platform.OS === 'ios' && CallNotificationNative?.reportCallEnded) {
      try {
        await CallNotificationNative.reportCallEnded();
      } catch (error) {
        console.error('[CallNotificationService] Report call ended error:', error);
      }
    }
  }

  /**
   * Report call connected (iOS CallKit)
   */
  async reportCallConnected(): Promise<void> {
    if (Platform.OS === 'ios' && CallNotificationNative?.reportCallConnected) {
      try {
        await CallNotificationNative.reportCallConnected();
      } catch (error) {
        console.error('[CallNotificationService] Report call connected error:', error);
      }
    }
  }

  /**
   * Configure and start Gotify service
   */
  async configureGotifyService(gotifyUrl: string, clientToken: string): Promise<boolean> {
    try {
      // Save configuration
      await AsyncStorage.setItem(GOTIFY_URL_KEY, gotifyUrl);
      await AsyncStorage.setItem(GOTIFY_TOKEN_KEY, clientToken);
      await AsyncStorage.setItem(SERVICE_ENABLED_KEY, 'true');

      // Start the service
      return await this.startGotifyService(gotifyUrl, clientToken);
    } catch (error) {
      console.error('[CallNotificationService] Configure Gotify error:', error);
      return false;
    }
  }

  /**
   * Start Gotify service with provided credentials
   */
  private async startGotifyService(gotifyUrl: string, clientToken: string): Promise<boolean> {
    try {
      if (Platform.OS === 'android' && CallNotificationNative) {
        // On Android, use native foreground service
        return await CallNotificationNative.startGotifyService(gotifyUrl, clientToken);
      } else {
        // On iOS, use JS-based client (only works when app is active)
        gotifyClientService.connect(gotifyUrl, clientToken, (message) => {
          // Check if it's a call notification
          const data = message.extras?.data || message.extras?.['client::notification']?.data;
          if (data?.type === 'call') {
            const callData: IncomingCallData = {
              callId: data.callId || '',
              callerId: data.callerId || '',
              callerName: data.callerName || 'Unknown',
              callType: data.callType || 'audio',
              isGroupCall: data.isGroupCall || false,
            };
            // Show CallKit notification
            this.showIncomingCallNotification(callData);
            // Notify callbacks
            this.incomingCallCallbacks.forEach(callback => callback(callData));
          }
        });
        return true;
      }
    } catch (error) {
      console.error('[CallNotificationService] Start Gotify service error:', error);
      return false;
    }
  }

  /**
   * Start Gotify service if previously configured
   */
  private async startGotifyServiceIfConfigured(): Promise<void> {
    try {
      const enabled = await AsyncStorage.getItem(SERVICE_ENABLED_KEY);
      if (enabled !== 'true') return;

      const gotifyUrl = await AsyncStorage.getItem(GOTIFY_URL_KEY);
      const clientToken = await AsyncStorage.getItem(GOTIFY_TOKEN_KEY);

      if (gotifyUrl && clientToken) {
        await this.startGotifyService(gotifyUrl, clientToken);
      }
    } catch (error) {
      console.error('[CallNotificationService] Auto-start Gotify error:', error);
    }
  }

  /**
   * Stop Gotify service
   */
  async stopGotifyService(): Promise<boolean> {
    try {
      await AsyncStorage.setItem(SERVICE_ENABLED_KEY, 'false');

      if (Platform.OS === 'android' && CallNotificationNative) {
        return await CallNotificationNative.stopGotifyService();
      } else {
        gotifyClientService.disconnect();
        return true;
      }
    } catch (error) {
      console.error('[CallNotificationService] Stop Gotify service error:', error);
      return false;
    }
  }

  /**
   * Add listener for call action events (accept/reject/missed)
   */
  addCallActionListener(callback: CallActionCallback): () => void {
    this.callActionCallbacks.add(callback);
    return () => {
      this.callActionCallbacks.delete(callback);
    };
  }

  /**
   * Add listener for incoming call events
   */
  addIncomingCallListener(callback: IncomingCallCallback): () => void {
    this.incomingCallCallbacks.add(callback);
    return () => {
      this.incomingCallCallbacks.delete(callback);
    };
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.callActionSubscription?.remove();
    this.incomingCallSubscription?.remove();
    this.callActionCallbacks.clear();
    this.incomingCallCallbacks.clear();
    gotifyClientService.disconnect();
    this.isInitialized = false;
  }
}

// Export singleton instance
export const callNotificationService = CallNotificationService.getInstance();
