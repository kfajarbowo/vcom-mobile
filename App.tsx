import React, {useEffect} from 'react';
import {AppNavigator} from './src/navigation/AppNavigator';
import {callNotificationService} from './src/services/callNotificationService';
import {initSiteConfigListener} from './src/services/siteConfigService';
import {ensureDnsMapReady} from './src/utils/dnsMap';
import {Toast} from './src/components/Toast';

// Jaringan lapangan tidak punya server DNS, sehingga hostname internal
// (chat.id / blm.id) tidak bisa di-resolve. Sama seperti aplikasi EXE, hostname
// ditukar menjadi IP sebelum dipakai. Dimulai di sini — sebelum React sempat
// merender — supaya balapan ke daftar master berjalan berbarengan dengan boot,
// bukan menunda permintaan pertama. Lihat .claude/dns-map-plan.md
ensureDnsMapReady();

function App(): React.JSX.Element {
  // Initialize the native call-notification bridge once on startup.
  // This wires the native -> JS event emitter (onIncomingCall / onCallAction),
  // registers the HeadlessJS reject task and requests the notification permission.
  //
  // IMPORTANT: the native background WebSocket foreground service is started and
  // stopped *exclusively* by AppNavigator based on auth state. It must stay running
  // for the entire authenticated session so that incoming calls and chat messages
  // still arrive (and post notifications) while the app is backgrounded or killed.
  //
  // This component used to stop that service every time the app returned to the
  // foreground and never restarted it, which meant that after the first time the
  // user reopened the app there was NO background transport left — so no call/chat
  // notifications showed once the app was closed or the screen turned off. That
  // AppState handling has been removed on purpose; the native service is the single
  // always-on background transport and duplicate notifications while the app is
  // visible are already suppressed natively (MainActivity.isAppInForeground gate).
  useEffect(() => {
    console.log('[App] Initializing call notification service');
    callNotificationService.initialize().catch(err =>
      console.warn('[App] callNotificationService.initialize failed:', err),
    );

    return () => {
      // Cleanup on unmount (app termination)
      callNotificationService.destroy();
    };
  }, []);

  // Apply site settings handed over by the Portal app (intent extras)
  useEffect(() => {
    return initSiteConfigListener();
  }, []);

  return (
    <>
      <AppNavigator />
      <Toast />
    </>
  );
}

export default App;
