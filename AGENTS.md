# AGENTS.md — VCommMobile

Panduan konteks untuk agen/AI yang bekerja di repo ini. Baca dulu sebelum
mengubah kode. Komentar di repo ini ditulis dalam **Bahasa Indonesia** dan
sengaja panjang untuk menjelaskan *alasan* (bukan sekadar *apa*) — pertahankan
gaya ini saat mengedit.

## 1. Ringkasan

**VCommMobile** adalah aplikasi mobile **React Native** untuk komunikasi
taktis/instansi: chat real-time, panggilan 1-lawan-1, panggilan grup, kirim
file/gambar/suara, dengan aktivasi lisensi dan pemilihan site server.

Bagian dari ekosistem **EyeSee / BLM / BMS** (site KEMHAN-PUSDATIN,
KEMHAN-MM, BSSN-RAGUNAN). Ada salinan `server-config.json` yang identik dengan
aplikasi EXE (EyeSee).

**Penting:** repo ini **Android-only**. Tidak ada folder `ios/` walaupun ada
`Gemfile` dan `README.md` bawaan RN. `npm run ios` tidak akan berfungsi.

## 2. Stack

| Lapisan | Teknologi |
|---|---|
| Framework | React Native **0.76.6**, React 18.3.1, TypeScript **5.0.4** |
| Mesin JS | Hermes **aktif**; New Architecture **mati** (`newArchEnabled=false`) |
| State | **Zustand** (`src/store/`), TanStack React Query |
| Form/validasi | react-hook-form + zod + @hookform/resolvers |
| Navigasi | @react-navigation (native, native-stack, bottom-tabs) |
| Styling | **NativeWind 2.0.11** + Tailwind CSS 3.3.2 (`className` di JSX) |
| Real-time | `ws` (JS) + **Background WebSocket Service native (OkHttp)** |
| Panggilan | **react-native-webrtc 118**, react-native-incall-manager; STUN Google + TURN internal |
| Media/File | react-native-video, audio-recorder-player, image-picker, image-zoom-viewer, document-picker, file-viewer, webview, rn-fetch-blob |
| Notifikasi | @notifee/react-native + modul native kustom |
| Storage | @react-native-async-storage/async-storage |
| Utilitas | crypto-js, date-fns, device-info, permissions, netinfo (**di-patch**) |
| QA | Jest + react-test-renderer, ESLint (`@react-native`), Prettier 2.8.8, patch-package |

## 3. Struktur Direktori

```
App.tsx                      # Root: init DNS map, call notification, site config listener
index.js                     # AppRegistry entry
config/server-config.json    # Salinan identik milik EXE (dnsMap + fallback urls)
src/
  navigation/                # AppNavigator (auth/license gate), MainNavigator, AuthNavigator
  screens/
    auth/                    # Login, Register, ForgotPassword
    main/                    # Chats (COMMS), Calls, Settings (CONFIG)
    LicenseActivationScreen.tsx
  components/                # ChatRoom, ChatList, NewConversation, call UI, Toast, ui/
  services/
    apiClient.ts             # Base URL + fetch wrapper + token. Titik cegat DNS map
    websocket.ts             # WebSocket JS (chat + signaling panggilan)
    backgroundWebSocketClient.ts
    webrtcService.ts / webrtcConfig.ts / oneOnOneCallService.ts / groupCallService.ts
    authService.ts / licenseService.ts / siteService.ts / siteConfigService.ts
    callNotificationService.ts
  store/                     # Zustand: authStore, chatStore, callStore, licenseStore
  utils/
    dnsMap/                  # Penerjemah hostname internal -> IP (flavor VPN)
    deviceInfo.ts / licenseCrypto.ts / permissions.ts
android/app/src/main/java/com/vcommmobile/   # Modul native Kotlin/Java kustom
android/app/src/vpn/res/values/strings.xml   # Nama app flavor VPN
.claude/dns-map-plan.md      # Dokumen desain DNS map (rujukan penting)
patches/                     # patch-package (netinfo)
```

## 4. Perintah Penting

Perintah dijalankan dari root repo, kecuali disebut lain.

```bash
npm install                                  # postinstall menjalankan patch-package
npm start                                    # Metro (atau: npx react-native start --reset-cache)

# Jalankan app — WAJIB pakai --mode karena ada flavor:
npx react-native run-android --mode prodDebug
npx react-native run-android --mode vpnDebug

# Build release (dari folder android/):
.\gradlew.bat assembleProdRelease             # VComm existing
.\gradlew.bat assembleVpnRelease              # VCOMM NXC VPN

# QA:
npm run lint                                 # eslint .
npm test                                     # jest (preset react-native)
npx tsc --noEmit                             # cek tipe
```

> Jangan menyebut `npm run android` sebagai perintah utama: script itu tidak
> menyertakan flavor, padahal `react { debuggableVariants }` di
> `android/app/build.gradle` hanya mengenal `prodDebug` dan `vpnDebug`.

## 5. Konfigurasi Environment (wajib dicek agen)

- **Node.js ≥ 18** (`engines.node`).
- **JDK 17** — `android/gradle.properties` meng-*hardcode*
  `org.gradle.java.home=C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot`.
  Bila tidak ada di path itu, edit atau sesuaikan baris tersebut.
- **Android SDK** — `android/local.properties`: `sdk.dir=C:\Android`.
- **Komponen SDK:** platform-35, build-tools 35.0.0, **NDK 26.1.10909125**
  (wajib untuk react-native-webrtc), minSdk 24, targetSdk 34, Kotlin 1.9.24,
  Gradle 8.12.
- **`adb`** dan `ANDROID_HOME` tersedia di PATH.

### Kenapa ada patch-package

`patches/@react-native-community+netinfo+11.4.1.patch` mengubah ambang versi
receiver Android dari 34 → 33. Wajib terpasang (via `postinstall`) agar NetInfo
benar di Android 13. Jangan buang tanpa alasan.

### `@vcomm/shared` (dependency lokal yang rapuh)

`package.json` memuat `"@vcomm/shared": "file:../vcomm-shared"`, tetapi folder
`../vcomm-shared` (saat ini `C:\Development\vcomm-shared`) **tidak ada**, dan
menghasilkan symlink mati di `node_modules/@vcomm/shared`. Akibatnya `npm ci` /
`npm install` bersih bisa gagal. Namun **tidak ada satu pun impor
`@vcomm/shared` di `src/`**. Jika perlu, sediakan repo tersebut, atau hapus
dependency-nya dari `package.json` + `package-lock.json`. Jangan menambahkan
impor baru ke paket ini tanpa memastikan sumbernya ada.

## 6. Arsitektur Kunci

```
boot (App.tsx)
  ├─ ensureDnsMapReady()          # hanya efektif di flavor VPN
  ├─ callNotificationService.initialize()
  └─ initSiteConfigListener()     # terima intent extras dari aplikasi Portal

AppNavigator
  ├─ initializeLicense() -> LicenseGate   # app TERKUNCI sampai lisensi valid
  └─ jika sessionToken -> MainNavigator (Chats/Calls/Settings) + komponen call global
       └─ websocketService.connect() + start native background service
```

### Endpoint default

| Keperluan | Default | Sumber |
|---|---|---|
| API + WebSocket | `http://chat.id:5000`, WS `ws://<host>:5000/ws` | `apiClient.ts` |
| Lisensi | `http://blm.id:3001` | `licenseService.ts` |
| Master data site | `http://blm.id:3003/api/v1/apps/<appKey>` | `siteService.ts` |
| TURN/STUN | `turn:<host>:3478` (test/test123) + STUN Google | `webrtcConfig.ts` |

Host/port dapat ditimpa lewat AsyncStorage (layar Settings / License Activation)
dan layar tersebut menyimpan **IP mentah**, sehingga DNS terlewati.

### DNS Map — hanya flavor VPN

Jaringan lapangan (termasuk Wi-Fi router RUT200) tidak punya server DNS.
`src/utils/dnsMap/` menukar hostname internal
(`eyesee.id`, `blm.id`, `bms.id`, `map.id`, `storage.id`, `chat.id`)
menjadi IP memakai **offset** dari `config/server-config.json`, dengan IP dasar
site ditemukan lewat balapan `fallbackApiUrls`.

- **Aktif hanya di varian `vpn`**, dideteksi via
  `DeviceInfo.getBundleId().endsWith('.vpn')` (`src/utils/dnsMap/index.ts`).
  VCOMM existing (`prod`) sengaja tidak diterjemahkan agar tidak berpindah site.
- Semua fungsi publik `async` dan menunggu `ensureDnsMapReady()`.
- **Titik cegat** (jangan tambah URL jaringan di luar ini): `getApiBaseUrl()`
  (`apiClient.ts`), `getLicenseServerUrl()` (`licenseService.ts`),
  `getIceServers()` (`webrtcConfig.ts`), `resolveUrl()` di `siteService.ts`.
- Gagal itu senyap/tidak fatal; config hilang → resolver jadi no-op.
- Detail lengkap desain: `.claude/dns-map-plan.md`. Log penanda: `[DnsMap] …`.

### WebSocket

- `src/services/websocket.ts` (JS) menangani chat **dan** signaling WebRTC.
  Tipe pesan didefinisikan di `WebSocketMessage.type` (banyak: `new_message`,
  `webrtc_offer/answer/ice_candidate`, `initiate_call`, event grup, dsb).
- `src/services/backgroundWebSocketClient.ts` + native
  `BackgroundWebSocketService.kt` adalah transport background **always-on**.
  Service native ini **hanya** dijalankan/dihentikan berdasarkan status auth di
  `AppNavigator`, bukan saat foreground/background. Jangan menambah
  start/stop di handler `AppState` — lihat komentar panjang di `App.tsx` dan
  `AppNavigator.tsx`; pernah menjadi bug "notifikasi hilang setelah app dibuka
  ulang".
- Selalu sediakan fallback: chat harus tetap jalan walau WebSocket gagal
  (`WEBSOCKET_TROUBLESHOOTING.md`).

### Panggilan (WebRTC)

- State ada di `callStore.ts`; UI global dirender di `AppNavigator`
  (`CallManager`, `IncomingCallModal`, `ActiveCallScreen`/`GroupCallScreen`).
- `getIceServers()` menerjemahkan host TURN lewat DNS map. Jangan menghardcode
  `turn:chat.id` di tempat lain.
- `authStore.logout()` **wajib** menutup panggilan berjalan sebelum menghapus
  token (kalau tidak, peer connection/mic/camera tetap hidup). Pertahankan.
- Panggilan masuk saat app tertutup ditangani native: `IncomingCallActivity`,
  `CallHeadlessTaskService`, `CallNotificationModule`, `CallActionReceiver`.

### Lisensi

`LicenseGate` (`src/components/LicenseGate.tsx`) **aktif memblokir seluruh app**
sampai lisensi tervalidasi ke server. Komentar `TESTING MODE: disabled` di file
itu **menyesatkan** — kodenya tetap memeriksa. Jangan menganggap lisensi bisa
dilewati tanpa mengubah kode.

### Flavor & varian

- `prod` → `com.vcommmobile`.
- `vpn` → `com.vcommmobile.vpn`, nama app **"VCOMM NXC VPN"** dari
  `android/app/src/vpn/res/values/strings.xml` (source set, bukan `resValue`).
- Debuggable variant: `prodDebug`, `vpnDebug`.
- Broadcast `com.vcommmobile.CLOSE_INCOMING_CALL_ACTIVITY` harus memakai
  `.setPackage(packageName)` agar tidak menutup activity app sebelah saat kedua
  varian terpasang berdampingan.
- Status terkini siklus rilis dan pekerjaan berjalan selalu ada di `HANDOFF.md`.

## 7. Konvensi Kerja

- **Tulis komentar dalam Bahasa Indonesia** bila perlu, dan jelaskan alasannya.
  Banyak komentar di repo ini adalah rekaman keputusan/bug — jangan hapus.
- Ikuti pola yang sudah ada: Zustand untuk state, wrapper `apiRequest`/
  `apiFetch` untuk HTTP (jangan `fetch` langsung tanpa alasan), `resolveHostname`/
  `resolveUrl` untuk URL jaringan internal.
- Setiap URL jaringan baru harus melewati DNS map agar konsisten di varian VPN.
- Redaksi rahasia: jangan menambah kredensial/secret baru ke repo (lihat §8).
- Sebelum menyatakan selesai, jalankan `npm run lint` dan `npx tsc --noEmit`;
  jalankan `npm test` bila menyentuh `src/utils/dnsMap/`.
- Jangan commit kecuali diminta.

## 8. Jebakan & Catatan Keamanan

- **Keystore rilis ter-commit:** `android/app/vcomm-release.keystore` +
  password di `android/gradle.properties` (`MYAPP_RELEASE_*`, `spero123!`).
  Perlakukan sebagai rahasia; jangan menyalin ke tempat publik. Idealnya rotasi
  dan pindahkan ke luar repo.
- **Cleartext HTTP diizinkan** (`usesCleartextTraffic="true"` +
  `network_security_config`). Wajar untuk internal; jangan dibawa ke produksi
  publik tanpa TLS.
- **Path JDK/SDK mesin-spesifik** (lihat §5) — penyebab umum build gagal di
  mesin baru.
- `build_log*.txt` dan `crash_log.txt` di root adalah log lama, bukan sumber
  kebenaran. `gradle.properties` sudah disetel untuk masalah jaringan
  (`preferIPv4Stack`, timeout 120s).
- Runtime permission yang diminta: kamera, mikrofon, storage,
  POST_NOTIFICATIONS, dan **exemption optimasi baterai** (agar foreground
  service tidak dibekukan Doze). Minta lewat `callNotificationService`.
- **`npm run ios` tidak valid** — tidak ada target iOS.

## 9. Dokumen Rujukan

- `HANDOFF.md` — status kerja yang **sedang berjalan**. **Baca ini lebih dulu
  sebelum melanjutkan pekerjaan**; isinya volatile (bukan konvensi) dan
  dikosongkan/diisi ulang saat tugas selesai.
- `README.md` — setup RN generik (bawaan, tidak lengkap untuk project ini).
- `.claude/dns-map-plan.md` — desain DNS map lintas aplikasi (BMS/BLM/VCOMM).
- `WEBSOCKET_TROUBLESHOOTING.md` — diagnosa WebSocket + fallback.
- `CHAT_TESTING_GUIDE.md` — checklist manual fitur chat (endpoint + skenario).

## 10. Disiplin Resource (perilaku agen)

Bagian ini mengikat agen agar hemat dan tidak melebar:

- Kerjakan **hanya** yang diminta. Jangan menambah refactor, file, dependency,
  komentar, tes, atau dokumentasi yang tidak diminta.
- Eksplorasi minimal: `grep`/`glob`/`read` seperlunya. Baca `AGENTS.md` ini
  dulu sebelum menjelajah repo.
- Jangan menjalankan perintah yang mengubah sistem (install, build, gradle,
  `git commit`) kecuali diminta eksplisit.
- Jangan menarik web atau memecah pekerjaan ke subagent besar tanpa izin.
- Kalau ragu atau menyentuh area berisiko (konfigurasi build, signing, native,
  DNS map, WebSocket, lisensi), **tanya dulu** daripada berasumsi.
- Akhiri dengan ringkasan singkat; tanpa pertanyaan atau tawaran lanjutan.

Pengaturan pendukung ada di `kilo.json` (compaction + permission).
