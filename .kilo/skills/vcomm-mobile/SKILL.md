---
name: vcomm-mobile
description: "Konteks dan alur kerja aman untuk repo VCommMobile (React Native Android, chat + panggilan WebRTC). Muat saat mengubah kode, menjalankan build/run, menyentuh DNS map/WebSocket/lisensi/flavor, atau saat butuh perintah per-flavor repo ini."
---

# VCommMobile — konteks & alur kerja

Aplikasi mobile React Native **Android-only** untuk komunikasi taktis: chat
real-time, panggilan 1-lawan-1/grup (WebRTC), kirim file/gambar/suara, dengan
aktivasi lisensi dan pemilihan site server. Bagian dari ekosistem
EyeSee/BLM/BMS.

Detail lengkap ada di `AGENTS.md` di root repo — **baca itu lebih dulu**.
Skill ini ringkasannya untuk dipakai on-demand.

## Kapan dipakai

- Mengubah kode di `src/` atau modul native di `android/app/src/main/java/`.
- Menjalankan atau membangun app (flavor `prod`/`vpn`).
- Menyentuh area berisiko: DNS map, WebSocket, WebRTC/panggilan, lisensi,
  konfigurasi Gradle/signing.

## Perintah per-flavor (penting)

```bash
npm start                                   # Metro
npx react-native run-android --mode prodDebug
npx react-native run-android --mode vpnDebug
# dari android/:
.\gradlew.bat assembleProdRelease
.\gradlew.bat assembleVpnRelease
npm run lint; npx tsc --noEmit; npm test
```

`npm run android` tanpa `--mode` tidak valid: hanya `prodDebug`/`vpnDebug`
yang terdaftar di `react { debuggableVariants }`.

## Aturan yang tidak boleh dilanggar

- URL jaringan internal harus lewat DNS map (`getApiBaseUrl`,
  `getLicenseServerUrl`, `getIceServers`, `resolveUrl`) — jangan hardcode host.
- DNS map aktif **hanya** di flavor `vpn`; jangan aktifkan untuk `prod`.
- Background WebSocket native dijalankan/dihentikan **hanya** oleh status auth
  di `AppNavigator`; jangan tambah start/stop di handler `AppState`.
- `authStore.logout()` wajib menutup panggilan berjalan sebelum hapus token.
- `LicenseGate` aktif memblokir app; komentar "TESTING MODE: disabled"
  menyesatkan — kodenya tetap memeriksa.
- Jangan commit kecuali diminta. Jangan install/build/gradle tanpa diminta.

## Alur kerja hemat

1. Baca `AGENTS.md`. 2. `grep`/`glob`/`read` seperlunya. 3. Edit minimal.
4. `npm run lint` + `npx tsc --noEmit`. 5. Ringkas, tanpa pertanyaan penutup.
