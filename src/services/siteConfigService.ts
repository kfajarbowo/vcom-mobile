/**
 * Site config handover from the Portal app.
 *
 * When the Portal app launches VComm it passes the selected site's connection
 * info as intent extras (site_ip / site_port / site_name / site_code). The
 * native SiteConfigModule captures those and this service applies them to the
 * stored server configuration automatically.
 */

import {
  NativeModules,
  DeviceEventEmitter,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS, setApiServer } from './apiClient';
import { useAuthStore } from '../store/authStore';
import { useToast } from '../components/Toast';

const { SiteConfigModule } = NativeModules;

export interface SiteConfig {
  ip: string;
  port: number;
  siteName?: string | null;
  siteCode?: string | null;
}

/**
 * Apply a site config received from Portal. No-op if the server is already
 * set to that host/port. Returns true if the config actually changed.
 */
export const applySiteConfig = async (config: SiteConfig): Promise<boolean> => {
  const host = config?.ip?.trim();
  const port = config?.port > 0 ? String(config.port) : '';
  if (!host || !port) {
    return false;
  }

  const prevHost = await AsyncStorage.getItem(STORAGE_KEYS.SERVER_HOST);
  const prevPort = await AsyncStorage.getItem(STORAGE_KEYS.SERVER_PORT);

  if (prevHost === host && prevPort === port) {
    console.log(`[SiteConfig] Server already set to ${host}:${port}`);
    return false;
  }

  console.log(
    `[SiteConfig] Portal handover: switching server to ${host}:${port}` +
      (config.siteName ? ` (${config.siteName})` : ''),
  );
  await setApiServer(host, port);

  useToast
    .getState()
    .show(`Site changed: ${config.siteName || host}`, 'info');

  // Any existing session belongs to the previous server — force re-login.
  const { sessionToken, logout } = useAuthStore.getState();
  if (sessionToken) {
    await logout();
  }

  return true;
};

/**
 * Start listening for site config handed over by the Portal app and apply
 * the one from the launch intent, if any. Call once on app start; returns a
 * cleanup function.
 */
export const initSiteConfigListener = (): (() => void) => {
  if (Platform.OS !== 'android' || !SiteConfigModule) {
    return () => {};
  }

  // App already running: portal re-launches us with a new intent
  const subscription = DeviceEventEmitter.addListener(
    'onSiteConfig',
    (config: SiteConfig) => {
      applySiteConfig(config).catch(err =>
        console.error('[SiteConfig] Failed to apply site config:', err),
      );
    },
  );

  // Cold start: pick up the config from the launch intent
  SiteConfigModule.consumeInitialSiteConfig()
    .then((config: SiteConfig | null) => {
      if (config) {
        return applySiteConfig(config);
      }
    })
    .catch((err: unknown) =>
      console.error('[SiteConfig] Failed to read initial site config:', err),
    );

  return () => subscription.remove();
};
