import React, {useEffect, useRef} from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {View, Text, ActivityIndicator, AppState, AppStateStatus} from 'react-native';
import {useAuthStore} from '../store/authStore';
import {useLicenseStore} from '../store/licenseStore';
import {LicenseGate} from '../components/LicenseGate';
import {AuthNavigator} from './AuthNavigator';
import {MainNavigator} from './MainNavigator';
import {IncomingCallModal} from '../components/IncomingCallModal';
import {ActiveCallScreen} from '../components/ActiveCallScreen';
import {GroupCallScreen} from '../components/GroupCallScreen';
import {CallManager} from '../components/CallManager';
import {websocketService} from '../services/websocket';
import {callNotificationService} from '../services/callNotificationService';
import {getApiBaseUrl} from '../services/apiClient';
import {useCallStore} from '../store/callStore';

export function AppNavigator() {
  const {sessionToken, isLoading, initialize, user} = useAuthStore();
  const {initialize: initializeLicense} = useLicenseStore();
  const isGroupCall = useCallStore((state: any) => state.isGroupCall);
  const appState = useRef(AppState.currentState);

  // Initialize license store on mount (must happen before auth)
  useEffect(() => {
    initializeLicense();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initialize auth store on mount
  useEffect(() => {
    initialize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ensure the native background WebSocket foreground service is running.
  // It MUST be started while the app is in the foreground (Android 12+ forbids
  // starting a foreground service from the background), so we (re)start it here on
  // auth and on every foreground transition. configureBackgroundService is
  // idempotent on the native side: if the service is already connected with the
  // same credentials it keeps the existing socket instead of reconnecting.
  const ensureBackgroundService = React.useCallback(async () => {
    if (!user) {return;}
    try {
      const baseUrl = await getApiBaseUrl();
      const wsUrl = baseUrl.replace('http', 'ws') + '/ws';
      console.log('[AppNavigator] Ensuring background service with URL:', wsUrl);
      await callNotificationService.configureBackgroundService(wsUrl, String(user.id));
      // Ask the user to exempt the app from battery optimization so the OS does not
      // freeze the background socket in Doze (no-op if already exempt / already asked).
      await callNotificationService.requestBatteryOptimizationExemption();
    } catch (error) {
      console.warn('[AppNavigator] Failed to ensure background service:', error);
    }
  }, [user]);

  // Ensure WebSocket connects whenever user is authenticated
  // Also start the background service for notifications.
  useEffect(() => {
    if (sessionToken && user) {
      console.log('[AppNavigator] User authenticated, ensuring WebSocket connection...');
      websocketService.connect(user.id).catch((error) => {
        console.warn('[AppNavigator] WebSocket connection failed (non-critical):', error);
      });

      // Start the background service while app is in foreground (required for Android 12+).
      // It stays running for the whole authenticated session and is only stopped on logout.
      ensureBackgroundService();
    } else {
      console.log('[AppNavigator] No session token, disconnecting WebSocket');
      websocketService.disconnect();
      // Stop background service when user logs out
      callNotificationService.stopBackgroundService().catch(console.warn);
    }
  }, [sessionToken, user, ensureBackgroundService]);

  // Handle app state changes (foreground/background)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextAppState: AppStateStatus) => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        console.log('[AppNavigator] App has come to foreground');

        // Reconnect JS WebSocket when app comes to foreground
        if (sessionToken && user) {
          console.log('[AppNavigator] Reconnecting WebSocket on foreground...');
          websocketService.connect(user.id).catch((error) => {
            console.warn('[AppNavigator] WebSocket reconnection failed:', error);
          });
          // Re-ensure the native background service is alive. This is a no-op /
          // cheap keep-alive when it is already running, but recovers it if the OS
          // (or an aggressive OEM) stopped just the service while the process lived.
          ensureBackgroundService();
        }
      } else if (nextAppState === 'background') {
        console.log('[AppNavigator] App has gone to background');
        // The native background service keeps running for the whole authenticated
        // session and handles notifications. We intentionally do NOT (re)start it
        // here: Android 12+ forbids starting a foreground service from the background.
      }

      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [sessionToken, user, ensureBackgroundService]);

  if (isLoading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" color="#8d9c6b" />
        <Text className="text-foreground mt-4">Loading...</Text>
      </View>
    );
  }

  return (
    <LicenseGate>
      <NavigationContainer>
        {sessionToken ? <MainNavigator /> : <AuthNavigator />}
      </NavigationContainer>

      {/* Call Components - Rendered globally */}
      {sessionToken && (
        <>
          <CallManager />
          <IncomingCallModal />
          {isGroupCall ? <GroupCallScreen /> : <ActiveCallScreen />}
        </>
      )}
    </LicenseGate>
  );
}
