# HANDOFF — status kerja

> ⚠️ File ini **VOLATILE**: isinya kondisi kerja saat ini, bukan konvensi.
> Perbarui/tanggalkan saat tugas selesai. Aturan yang berlaku selamanya tetap
> di `AGENTS.md`.

Terakhir diperbarui: 2026-10-22 · branch: `badar-feat/vpn-configuration-apk`

## Status Saat Ini

- Branch ini mengimplementasikan konfigurasi **VPN & DNS Map** agar aplikasi VCOMM
  dapat berjalan di jaringan taktis/lapangan via **VPN (Router Teltonika RUT200)**
  tanpa ketergantungan pada server DNS eksternal/APN bawaan SIM.
- **Kondisi terkini:** Aplikasi **sudah bisa dibuka dan terhubung lewat VPN (RUT200)**.
  Mekanisme DNS Map internal berhasil menerjemahkan hostname internal
  (`chat.id`, `blm.id`, `bms.id`, `eyesee.id`, `map.id`, `storage.id`) menjadi IP
  konkret melalui balapan fallback master IP dan kalkulasi offset.

## Keputusan & Arsitektur di Branch Ini

1. **DNS Map Internal Resolver (`src/utils/dnsMap/`):**
   - Mengatasi ketiadaan DNS server saat HP terhubung ke Wi-Fi router RUT200.
   - Menggunakan referensi konfigurasi yang identik dengan aplikasi desktop (EyeSee EXE):
     `config/server-config.json`.
   - Balapan `fallbackApiUrls` serentak saat boot (`App.tsx` -> `ensureDnsMapReady()`)
     untuk menentukan `siteBaseIp`, lalu menerapkan offset:
     - `eyesee.id`: offset 0 (dasar)
     - `blm.id`: offset -1
     - `bms.id`: offset -2
     - `map.id`: offset -3
     - `storage.id`: offset +1
     - `chat.id`: offset +2
   - **Gating:** DNS Map aktif **hanya** pada varian VPN, dideteksi via
     `DeviceInfo.getBundleId().endsWith('.vpn')`. Varian existing (`prod`) tidak terpengaruh.
   - Titik integrasi: `getApiBaseUrl()` (`apiClient.ts`), `getLicenseServerUrl()`
     (`licenseService.ts`), `getIceServers()` (`webrtcConfig.ts`), dan `fetchCustomSites()`
     (`siteService.ts`).

2. **Flavor `vpn` (`android/app/build.gradle`):**
   - `applicationId`: `com.vcommmobile.vpn` (`applicationIdSuffix ".vpn"`).
   - Nama aplikasi: **"VCOMM NXC VPN"** (`android/app/src/vpn/res/values/strings.xml`).
   - Terpasang **berdampingan** dengan VCOMM existing di HP tanpa menimpanya; data
     dan sesi `AsyncStorage` otomatis terisolasi.
   - Broadcast intent `CLOSE_INCOMING_CALL_ACTIVITY` di-scope menggunakan
     `.setPackage(packageName)` agar tidak menutup activity panggilan milik aplikasi sebelah.

## Perubahan Terkini (2026-10-22)

1. **Bypass Lisensi (Sesuai Permintaan):**
   - [src/components/LicenseGate.tsx](file:///c:/Development/VCOMM-Moblie/src/components/LicenseGate.tsx): Langsung merender `children` tanpa memblokir aplikasi.
   - [src/store/licenseStore.ts](file:///c:/Development/VCOMM-Moblie/src/store/licenseStore.ts): State lisensi default langsung `isLicenseValid: true`, `isLoading: false`, `hasCheckedLicense: true`.

2. **Perbaikan Double-Accept Popup Panggilan (Background / Layar Mati):**
   - **Penyebab:** Ketika user menekan Accept di layar native (`IncomingCallActivity` / notifikasi), aplikasi dibuka ke foreground. Namun status di React store (`callStore`) saat itu masih `idle` (belum menerima `incoming_call`). Akibatnya event accept diabaikan oleh `CallManager`. Sesaat kemudian event `incoming_call` masuk, mengubah status menjadi `ringing`, sehingga memunculkan popup `IncomingCallModal` kedua di dalam React Native.
   - **Solusi:**
     - [android/app/src/main/java/com/vcommmobile/CallNotificationModule.kt](file:///c:/Development/VCOMM-Moblie/android/app/src/main/java/com/vcommmobile/CallNotificationModule.kt): Ditambahkan cache `pendingCallAction` dan method native `consumeInitialCallAction()` agar event accept dari native tetap tersimpan saat cold-start.
     - [src/services/callNotificationService.ts](file:///c:/Development/VCOMM-Moblie/src/services/callNotificationService.ts): Mengonsumsi `consumeInitialCallAction()` saat boot JS.
     - [src/components/CallManager.tsx](file:///c:/Development/VCOMM-Moblie/src/components/CallManager.tsx): Ketika menerima aksi `accept`, store langsung di-*set* ke status `calling` (bukan `ringing`), sehingga `IncomingCallModal` tidak pernah muncul lagi. Ketika SDP offer tiba, panggilan langsung dijawab otomatis (`answerCall`).

3. **Perbaikan Video Call HP-ke-HP di Jaringan Wi-Fi RUT200:**
   - **Penyebab:**
     1. Jaringan RUT200 tidak memiliki akses server DNS publik. Di [src/services/webrtcConfig.ts](file:///c:/Development/VCOMM-Moblie/src/services/webrtcConfig.ts), server STUN yang terdaftar hanyalah Google STUN (`stun.l.google.com`), sehingga libwebrtc mengalami timeout DNS 10-30 detik saat mengumpulkan ICE candidate.
     2. Resolusi 720p (1280x720) 30fps dengan bitrate 1.5 Mbps terlalu besar untuk kapasitas Wi-Fi & VPN tunnel router RUT200, menyebabkan packet drops dan kegagalan transmisi video.
   - **Solusi:**
     - [src/services/webrtcConfig.ts](file:///c:/Development/VCOMM-Moblie/src/services/webrtcConfig.ts): Menambahkan server internal coturn `{ urls: 'stun:' + turnServer }` di urutan pertama ICE servers. Coturn bertindak sebagai STUN & TURN lokal tanpa butuh DNS eksternal.
     - [src/services/webrtcConfig.ts](file:///c:/Development/VCOMM-Moblie/src/services/webrtcConfig.ts) & [src/services/oneOnOneCallService.ts](file:///c:/Development/VCOMM-Moblie/src/services/oneOnOneCallService.ts): Menyesuaikan profil video taktis menjadi 640x480 @ 20fps dengan bitrate 500 kbps agar bandwidth ringan dan stabil melalui router RUT200.

4. **Perbaikan Pemilihan Site Server (Login & Settings):**
   - **Penyebab:**
     1. Dengan lisensi di-bypass, layar `LicenseActivationScreen` terlewati sehingga pengguna berpindah memilih site di `LoginScreen` atau `SettingsScreen`.
     2. Tombol dropdown "SELECT SITE" sebelumnya disembunyikan secara kondisional hanya ketika host bukan `chat.id` (harus klik "Custom" dulu).
     3. Terdapat logika pengecekan ping HTTP port 5000 (`checkSiteStatus`), yang jika timeout/offline langsung me-revert host kembali ke `chat.id` dan memblokir klik pemilihan (`if (status === false) return;`).
     4. API master site (`/api/v1/apps/chat`) belum tentu terdaftar jika server BLM hanya menyediakan master key `eyesee`.
   - **Solusi:**
     - [src/services/siteService.ts](file:///c:/Development/VCOMM-Moblie/src/services/siteService.ts): Ditambahkan `DEFAULT_SITES` (`KEMHAN-PUSDATIN`, `KEMHAN-MM`, `BSSN-RAGUNAN`) dan fallback fetch ke key `eyesee` bila `chat` kosong, serta fallback ke `DEFAULT_SITES` jika endpoint master offline.
     - [src/screens/auth/LoginScreen.tsx](file:///c:/Development/VCOMM-Moblie/src/screens/auth/LoginScreen.tsx) & [src/screens/main/SettingsScreen.tsx](file:///c:/Development/VCOMM-Moblie/src/screens/main/SettingsScreen.tsx): Dropdown SELECT SITE kini selalu ditampilkan secara permanen, auto-revert ke `chat.id` dihapus, dan user bebas memilih site server meskipun indikator ping mendeteksi offline.

## Perintah Penting (Per-Flavor)

```bash
# Metro bundler:
npm start

# Jalankan varian VPN di perangkat / emulator:
npx react-native run-android --mode vpnDebug

# Build APK Release varian VPN (dari direktori android/):
.\gradlew.bat assembleVpnRelease

# Build APK Release varian standar (prod):
.\gradlew.bat assembleProdRelease

# Testing & QA:
npm run lint
npx tsc --noEmit
npm test -- __tests__/dnsMapResolver.test.ts
```

## Artefak APK Terkait

- `android/app/build/outputs/apk/vpn/release/app-vpn-release.apk` — hasil build
  release varian VPN ("VCOMM NXC VPN").
- `android/app/build/outputs/apk/vpn/debug/app-vpn-debug.apk` — APK debug varian VPN.

## Langkah Berikutnya

1. [x] Implementasi persistent background WebSocket & DNS Map internal resolver.
2. [x] Bypass lisensi agar aplikasi langsung masuk tanpa aktivasi.
3. [x] Selesaikan bug double-accept popup panggilan dari background/layar mati.
4. [x] Tambahkan STUN coturn lokal & optimasi bitrate video untuk Wi-Fi RUT200.
5. [x] Perbaiki pemilihan site server di Login dan Settings agar selalu dapat dipilih.
6. [ ] Build APK varian VPN terbaru via `.\gradlew.bat assembleVpnRelease`.
7. [ ] Pengujian langsung di perangkat lapangan dengan koneksi router RUT200.
