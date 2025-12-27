import AsyncStorage from '@react-native-async-storage/async-storage';
import {initializeApiClient} from '@vcomm/shared';

// Initialize the API client with AsyncStorage
export function initializeApi() {
  initializeApiClient(AsyncStorage);
  console.log('[API] API client initialized with AsyncStorage');
}
