/**
 * Cross-platform call notification service
 * Handles incoming call notifications for both Android and iOS
 */

import {
  NativeModules,
  NativeEventEmitter,
  Platform,
  AppRegistry,
  AppState,
  EmitterSubscription,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { IncomingCallData, CallActionEvent } from '../types/native';
import { backgroundWebSocketClient } from './backgroundWebSocketClient';

// Get the appropriate native module based on platform
const CallNotificationNative = Platform.select({
  ios: NativeModules.CallKitModule,
  android: NativeModules.CallNotificationModule,
});

// Storage keys
const SERVICE_URL_KEY = '@background_service_url';
const SERVICE_TOKEN_KEY = '@background_service_token';
const SERVICE_ENABLED_KEY = '@background_service_enabled';

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

  private constructor() { }

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

      // NOTE: Don't auto-start background service here
      // It creates a second WebSocket connection that interferes with the JS WebSocket
      // The background service should only run when the app is in background/killed
      // await this.startBackgroundServiceIfConfigured();

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
    if (!this.eventEmitter) {return;}

    // Listen for call action events (accept/reject from notification)
    this.callActionSubscription = this.eventEmitter.addListener(
      'onCallAction',
      (event: CallActionEvent) => {
        console.log('[CallNotificationService] Call action:', event);
        this.callActionCallbacks.forEach(callback => callback(event));
      }
    );

    // Listen for incoming call events (from Background service)
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
      if (!CallNotificationNative) {return false;}

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
      if (!CallNotificationNative) {return false;}
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

      // On Android the native background foreground service posts the incoming-call
      // notification whenever the app is NOT in the foreground. The JS WebSocket stays
      // connected in the background too (the foreground service keeps the process alive),
      // so if JS also posted here we would get a double ring/vibrate and a re-fired
      // full-screen intent. Only self-post from JS while the app is foreground; let the
      // native service own it when backgrounded. (iOS has no such native service, so it
      // always posts here.)
      if (Platform.OS === 'android' && AppState.currentState !== 'active') {
        console.log('[CallNotificationService] App not foreground; native service owns the call notification');
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
      if (!CallNotificationNative?.cancelCallNotification) {
        // Method not implemented in native module
        console.log('[CallNotificationService] cancelCallNotification not available');
        return true;
      }
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
   * Ask the OS to exempt the app from battery optimization (Android only).
   *
   * Without this the system freezes the background service's WebSocket in Doze /
   * App-Standby once the screen has been off for a while, so incoming calls/chats
   * never arrive. The native module is a no-op if the app is already exempt, and it
   * only shows the system dialog once (it remembers that it already asked) so the
   * user is not nagged on every foreground.
   */
  async requestBatteryOptimizationExemption(): Promise<boolean> {
    try {
      if (Platform.OS !== 'android' || !CallNotificationNative?.requestBatteryOptimizationExemption) {
        return false;
      }
      return await CallNotificationNative.requestBatteryOptimizationExemption();
    } catch (error) {
      console.warn('[CallNotificationService] Battery optimization request error:', error);
      return false;
    }
  }

  /**
   * Configure and start Background service
   */
  async configureBackgroundService(url: string, tokenOrUserId: string): Promise<boolean> {
    try {
      // Save configuration
      await AsyncStorage.setItem(SERVICE_URL_KEY, url);
      await AsyncStorage.setItem(SERVICE_TOKEN_KEY, tokenOrUserId);
      await AsyncStorage.setItem(SERVICE_ENABLED_KEY, 'true');

      // Start the service
      return await this.startBackgroundService(url, tokenOrUserId);
    } catch (error) {
      console.error('[CallNotificationService] Configure Background service error:', error);
      return false;
    }
  }

  /**
   * Start Background service with provided credentials
   */
  private async startBackgroundService(url: string, tokenOrUserId: string): Promise<boolean> {
    try {
      if (Platform.OS === 'android' && CallNotificationNative) {
        // On Android, use native foreground service
        return await CallNotificationNative.startBackgroundService(url, tokenOrUserId);
      } else {
        // iOS background handling would go here (e.g. APNs or VoIP push)
        // For now, iOS relies on app being active or standard push notifications
        console.log('[CallNotificationService] Background service not implemented for iOS in this module');
        return true;
      }
    } catch (error) {
      console.error('[CallNotificationService] Start Background service error:', error);
      return false;
    }
  }

  /**
   * Start Background service if previously configured
   */
  private async startBackgroundServiceIfConfigured(): Promise<void> {
    try {
      const enabled = await AsyncStorage.getItem(SERVICE_ENABLED_KEY);
      if (enabled !== 'true') {return;}

      const url = await AsyncStorage.getItem(SERVICE_URL_KEY);
      const tokenOrUserId = await AsyncStorage.getItem(SERVICE_TOKEN_KEY);

      if (url && tokenOrUserId) {
        await this.startBackgroundService(url, tokenOrUserId);
      }
    } catch (error) {
      console.error('[CallNotificationService] Auto-start Background service error:', error);
    }
  }

  /**
   * Stop Background service
   */
  async stopBackgroundService(): Promise<boolean> {
    try {
      await AsyncStorage.setItem(SERVICE_ENABLED_KEY, 'false');

      if (Platform.OS === 'android' && CallNotificationNative) {
        return await CallNotificationNative.stopBackgroundService();
      } else {
        backgroundWebSocketClient.disconnect();
        return true;
      }
    } catch (error) {
      console.error('[CallNotificationService] Stop Background service error:', error);
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
    backgroundWebSocketClient.disconnect();
    this.isInitialized = false;
  }
}

// Export singleton instance
export const callNotificationService = CallNotificationService.getInstance();
