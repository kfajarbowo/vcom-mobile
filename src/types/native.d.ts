/**
 * Native module type definitions for call notifications
 */



export interface IncomingCallData {
  callId: string;
  callerId: string;
  callerName: string;
  callType: 'audio' | 'video';
  isGroupCall: boolean;
}

export interface CallActionEvent extends IncomingCallData {
  action: 'accept' | 'reject' | 'missed';
  payload?: string;
}

export interface CallNotificationModuleInterface {
  /**
   * Show an incoming call notification (full-screen on Android, CallKit on iOS)
   */
  showIncomingCallNotification(
    callId: string,
    callerId: string,
    callerName: string,
    callType: string,
    isGroupCall: boolean
  ): Promise<boolean>;

  /**
   * Cancel/dismiss the incoming call notification
   */
  cancelCallNotification(): Promise<boolean>;

  /**
   * Start the background service (Android only, no-op on iOS)
   */
  startBackgroundService(url: string, tokenOrUserId: string): Promise<boolean>;

  /**
   * Stop the background service (Android only, no-op on iOS)
   */
  stopBackgroundService(): Promise<boolean>;

  /**
   * Request exemption from battery optimization / Doze (Android only).
   * Resolves true if the app is (or becomes) exempt; shows the system dialog at
   * most once. No-op on iOS.
   */
  requestBatteryOptimizationExemption?(): Promise<boolean>;

  /**
   * Request notification permission (Android 13+)
   */
  requestNotificationPermission(): Promise<'granted' | 'requested' | 'no_activity' | 'not_required'>;

  /**
   * Consume any initial call action that launched the app before JS was ready
   */
  consumeInitialCallAction?(): Promise<CallActionEvent | null>;

  /**
   * Check if notification permission is granted
   */
  checkNotificationPermission(): Promise<boolean>;

  /**
   * Report call ended (iOS only - for CallKit)
   */
  reportCallEnded?(): Promise<boolean>;

  /**
   * Report call connected (iOS only - for CallKit)
   */
  reportCallConnected?(): Promise<boolean>;

  /**
   * Add event listener
   */
  addListener(eventName: string): void;

  /**
   * Remove event listeners
   */
  removeListeners(count: number): void;
}

// Native module types for NativeModules
declare module 'react-native' {
  interface NativeModulesStatic {
    CallNotificationModule: CallNotificationModuleInterface;
    CallKitModule: CallNotificationModuleInterface;
  }
}

export interface GotifyMessage {
  id: number;
  appid: number;
  message: string;
  title: string;
  priority: number;
  date: string;
  extras?: {
    data?: {
      type?: string;
      callId?: string;
      callerId?: string;
      callerName?: string;
      callType?: 'audio' | 'video';
      isGroupCall?: boolean;
    };
    'client::notification'?: {
      data?: {
        type?: string;
        callId?: string;
        callerId?: string;
        callerName?: string;
        callType?: 'audio' | 'video';
        isGroupCall?: boolean;
      };
    };
  };
}
