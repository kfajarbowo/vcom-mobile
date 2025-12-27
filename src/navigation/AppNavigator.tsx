import React, {useEffect} from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {View, Text, ActivityIndicator} from 'react-native';
import {useAuthStore} from '../store/authStore';
import {AuthNavigator} from './AuthNavigator';
import {MainNavigator} from './MainNavigator';
import {IncomingCallModal} from '../components/IncomingCallModal';
import {ActiveCallScreen} from '../components/ActiveCallScreen';
import {CallManager} from '../components/CallManager';

export function AppNavigator() {
  const {sessionToken, isLoading, initialize} = useAuthStore();

  useEffect(() => {
    initialize();
  }, []);

  if (isLoading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" color="#8d9c6b" />
        <Text className="text-foreground mt-4">Loading...</Text>
      </View>
    );
  }

  return (
    <>
      <NavigationContainer>
        {sessionToken ? <MainNavigator /> : <AuthNavigator />}
      </NavigationContainer>

      {/* Call Components - Rendered globally */}
      {sessionToken && (
        <>
          <CallManager />
          <IncomingCallModal />
          <ActiveCallScreen />
        </>
      )}
    </>
  );
}
