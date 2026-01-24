import React, {useEffect, useRef} from 'react';
import {AppState} from 'react-native';
import {AppNavigator} from './src/navigation/AppNavigator';
import {websocketService} from './src/services/websocket';
import {callNotificationService} from './src/services/callNotificationService';
import {Toast} from './src/components/Toast';

function App(): React.JSX.Element {
  const appState = useRef(AppState.currentState);

  // Initialize call notification service on app start
  useEffect(() => {
    console.log('[App] Initializing call notification service');
    callNotificationService.initialize();

    return () => {
      // Cleanup on unmount (app termination)
      callNotificationService.destroy();
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        console.log('[App] App came to foreground - reconnecting WebSocket');
        websocketService.connect();
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
