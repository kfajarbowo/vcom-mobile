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
  }, []);

  // Initialize auth store on mount
  useEffect(() => {
    initialize();
  }, []);

  // Ensure WebSocket connects whenever user is authenticated
  // Also start background service for notifications (must start while in foreground due to Android 12+ restrictions)
  useEffect(() => {
    if (sessionToken && user) {
      console.log('[AppNavigator] User authenticated, ensuring WebSocket connection...');
      websocketService.connect(user.id).catch((error) => {
        console.warn('[AppNavigator] WebSocket connection failed (non-critical):', error);
      });

      // Start background service while app is in foreground (required for Android 12+)
      // The service will handle notifications when app goes to background
      const startBackgroundService = async () => {
        try {
          const baseUrl = await getApiBaseUrl();
          const wsUrl = baseUrl.replace('http', 'ws') + '/ws';
          console.log('[AppNavigator] Starting background service with URL:', wsUrl);
          await callNotificationService.configureBackgroundService(wsUrl, String(user.id));
          console.log('[AppNavigator] Background service started successfully');
        } catch (error) {
          console.warn('[AppNavigator] Failed to start background service:', error);
        }
      };
      startBackgroundService();
    } else {
      console.log('[AppNavigator] No session token, disconnecting WebSocket');
      websocketService.disconnect();
      // Stop background service when user logs out
      callNotificationService.stopBackgroundService().catch(console.warn);
    }
  }, [sessionToken, user]);

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
        }
      } else if (nextAppState === 'background') {
        console.log('[AppNavigator] App has gone to background');
        // Background service is already running and will handle notifications
      }

      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [sessionToken, user]);

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
