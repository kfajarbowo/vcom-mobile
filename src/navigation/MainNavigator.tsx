import React from 'react';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {Text, View, StyleSheet} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {ChatsScreen} from '../screens/main/ChatsScreen';
import {CallsScreen} from '../screens/main/CallsScreen';
import {SettingsScreen} from '../screens/main/SettingsScreen';

export type MainTabParamList = {
  Chats: undefined;
  Calls: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

// Custom icon component
const TabIcon = ({
  iconName,
  label,
  focused,
}: {
  iconName: string;
  label: string;
  focused: boolean;
}) => {
  return (
    <View style={styles.tabIconContainer}>
      <View
        style={[
          styles.iconWrapper,
          focused && styles.iconWrapperActive,
        ]}>
        <MaterialCommunityIcons
          name={iconName}
          size={focused ? 24 : 22}
          color={focused ? '#a6c455' : '#666'}
        />
      </View>
      <Text style={[styles.label, focused && styles.labelActive]}>{label}</Text>
    </View>
  );
};

export function MainNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false, // Hide default header, we'll use custom ones in each screen
        tabBarStyle: {
          backgroundColor: '#1a1a1a',
          borderTopWidth: 2,
          borderTopColor: '#4d5d30',
          height: 70,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarShowLabel: false,
        tabBarActiveTintColor: '#a6c455',
        tabBarInactiveTintColor: '#666',
      }}>
      <Tab.Screen
        name="Chats"
        component={ChatsScreen}
        options={{
          tabBarIcon: ({focused}) => (
            <TabIcon iconName="message-text" label="COMMS" focused={focused} />
          ),
        }}
      />
      <Tab.Screen
        name="Calls"
        component={CallsScreen}
        options={{
          tabBarIcon: ({focused}) => (
            <TabIcon iconName="phone" label="CALLS" focused={focused} />
          ),
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          tabBarIcon: ({focused}) => (
            <TabIcon iconName="cog" label="CONFIG" focused={focused} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabIconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapper: {
    width: 48,
    height: 38,
    backgroundColor: '#2a2a2a',
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#3a3a3a',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  iconWrapperActive: {
    backgroundColor: '#4d5d30',
    borderColor: '#5a6b38',
  },
  label: {
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 1,
    color: '#666',
  },
  labelActive: {
    color: '#a6c455',
  },
});
