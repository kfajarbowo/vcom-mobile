import React, {useEffect, useRef} from 'react';
import {AppState, Platform} from 'react-native';
import {AppNavigator} from './src/navigation/AppNavigator';
import {websocketService} from './src/services/websocket';
import {callNotificationService} from './src/services/callNotificationService';
import {initSiteConfigListener} from './src/services/siteConfigService';
import {Toast} from './src/components/Toast';

function App(): React.JSX.Element {
  const appState = useRef(AppState.currentState);

  // Initialize call notification service on app start (but don't start background service yet)
  useEffect(() => {
    console.log('[App] Initializing call notification service');
    // Note: We'll manage background service based on app state
    // Don't auto-start it here to avoid dual WebSocket connections

    return () => {
      // Cleanup on unmount (app termination)
      callNotificationService.destroy();
    };
  }, []);

  // Apply site settings handed over by the Portal app (intent extras)
  useEffect(() => {
    return initSiteConfigListener();
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      console.log('[App] App state changed:', appState.current, '->', nextAppState);

      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        // App came to FOREGROUND
        console.log('[App] App came to foreground - stopping background service, reconnecting JS WebSocket');

        // Stop the background service to avoid dual connections
        if (Platform.OS === 'android') {
          callNotificationService.stopBackgroundService().catch(err =>
            console.log('[App] Error stopping background service:', err)
          );
        }

        // Reconnect the JS WebSocket
        websocketService.connect();
      } else if (
        appState.current === 'active' &&
        nextAppState.match(/inactive|background/)
      ) {
        // App went to BACKGROUND
        console.log('[App] App went to background - background service can handle calls');
        // Note: Background service for calls can be started here if needed
        // For now, we rely on the JS WebSocket disconnecting naturally
      }

      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, []);

  return (
    <>
      <AppNavigator />
      <Toast />
    </>
  );
}

export default App;
