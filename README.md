# VCommMobile

Aplikasi mobile berbasis **React Native (Android-only)** untuk komunikasi taktis dan instansi, mendukung chat real-time, panggilan suara/video 1-lawan-1 & grup, transfer media/dokumen/voice note, serta konfigurasi site server dan integrasi jaringan lapangan (VPN/RUT200).

Aplikasi ini merupakan bagian dari ekosistem **EyeSee / BLM / BMS**.

---

## 📋 Catatan Rilis (Release Notes)

### Versi 1.0.1

Rilis **1.0.1** berfokus pada stabilitas jaringan lapangan (taktis), optimalisasi panggilan WebRTC di bandwidth terbatas, persistensi koneksi background, serta penambahan varian khusus VPN.

#### 🚀 Fitur Baru (New Features)
- **Varian Aplikasi VPN (`com.vcommmobile.vpn`):**
  - Menambahkan product flavor `vpn` dengan nama aplikasi **"VCOMM NXC VPN"**.
  - Aplikasi dapat terpasang berdampingan (*co-exist*) dengan versi rilis utama (`prod`) pada satu perangkat tanpa menimpa data dan sesi `AsyncStorage`.
- **Internal DNS Map Resolver ([src/utils/dnsMap/](file:///c:/Development/VCOMM-Moblie/src/utils/dnsMap)):**
  - Menerjemahkan hostname internal (`chat.id`, `blm.id`, `bms.id`, `eyesee.id`, `map.id`, `storage.id`) secara otomatis menjadi alamat IP konkret.
  - Menggunakan referensi konfigurasi `config/server-config.json` dengan mekanisme balapan fallback URL untuk menentukan *site base IP* dan kalkulasi offset port/IP.
  - Memungkinkan aplikasi beroperasi mandiri di jaringan Wi-Fi router lapangan (seperti Teltonika RUT200) tanpa memerlukan server DNS publik atau APN khusus.
- **Persistent Background WebSocket Service:**
  - Implementasi service native Android berbasis OkHttp ([BackgroundWebSocketService.kt](file:///c:/Development/VCOMM-Moblie/android/app/src/main/java/com/vcommmobile/BackgroundWebSocketService.kt)) yang *always-on* untuk menjamin penerimaan notifikasi pesan dan signaling panggilan saat aplikasi berada di latar belakang.

#### 🛠️ Perbaikan Bug & Peningkatan (Bug Fixes & Improvements)
- **Optimalisasi WebRTC untuk Jaringan Lapangan / RUT200:**
  - **STUN Lokal Internal:** Menambahkan server internal coturn (`stun:<turn-server>`) di urutan teratas konfigurasi ICE servers ([src/services/webrtcConfig.ts](file:///c:/Development/VCOMM-Moblie/src/services/webrtcConfig.ts)). Mengeliminasi DNS timeout selama 10–30 detik saat perangkat berada di jaringan tanpa akses DNS publik Google STUN.
  - **Profil Video Taktis:** Menyesuaikan resolusi video call menjadi 640x480 @ 20fps dengan target bitrate 500 kbps (dari sebelumnya 720p 30fps @ 1.5 Mbps) di [src/services/oneOnOneCallService.ts](file:///c:/Development/VCOMM-Moblie/src/services/oneOnOneCallService.ts) dan [src/services/webrtcConfig.ts](file:///c:/Development/VCOMM-Moblie/src/services/webrtcConfig.ts) demi transmisi video yang stabil dan lancar melalui tunnel VPN ber-bandwidth terbatas.
- **Perbaikan Double-Accept Popup Panggilan (Cold-Start / Layar Terkunci):**
  - Mengatasi kemunculan modal panggilan masuk ganda saat panggilan dijawab langsung dari notifikasi sistem / layar native Android ([IncomingCallActivity](file:///c:/Development/VCOMM-Moblie/android/app/src/main/java/com/vcommmobile/IncomingCallActivity.kt)).
  - Menambahkan caching `pendingCallAction` native ([CallNotificationModule.kt](file:///c:/Development/VCOMM-Moblie/android/app/src/main/java/com/vcommmobile/CallNotificationModule.kt)) dan fungsi konsumsi saat inisialisasi JS ([callNotificationService.ts](file:///c:/Development/VCOMM-Moblie/src/services/callNotificationService.ts)).
  - Menyinkronkan status panggilan langsung ke status aktif di [src/components/CallManager.tsx](file:///c:/Development/VCOMM-Moblie/src/components/CallManager.tsx) saat event accept diterima.
- **Peningkatan Pemilihan Site Server (Login & Settings):**
  - Dropdown **SELECT SITE** kini selalu dapat diakses di layar [LoginScreen.tsx](file:///c:/Development/VCOMM-Moblie/src/screens/auth/LoginScreen.tsx) dan [SettingsScreen.tsx](file:///c:/Development/VCOMM-Moblie/src/screens/main/SettingsScreen.tsx).
  - Menyediakan daftar master site bawaan (`DEFAULT_SITES`: `KEMHAN-PUSDATIN`, `KEMHAN-MM`, `BSSN-RAGUNAN`) dan mekanisme fallback ke master key `eyesee` pada [src/services/siteService.ts](file:///c:/Development/VCOMM-Moblie/src/services/siteService.ts) apabila API master offline.
  - Menghapus pemblokiran seleksi otomatis saat pengecekan ping HTTP port 5000 tidak merespons, sehingga pengguna tetap fleksibel memilih target site.
- **Bypass Gate Lisensi:**
  - Memperbarui [src/components/LicenseGate.tsx](file:///c:/Development/VCOMM-Moblie/src/components/LicenseGate.tsx) dan [src/store/licenseStore.ts](file:///c:/Development/VCOMM-Moblie/src/store/licenseStore.ts) agar aplikasi dapat langsung masuk dan digunakan tanpa hambatan aktivasi lisensi BLM selama masa operasional dan testing.
- **Isolasi Broadcast Multi-Flavor:**
  - Penambahan pembatasan package (`.setPackage(packageName)`) pada intent broadcast `CLOSE_INCOMING_CALL_ACTIVITY` di modul native agar penutupan panggilan pada varian VPN tidak memengaruhi varian Standar yang berjalan bersamaan.

---

### Versi 1.0.0
- Rilis baseline awal aplikasi komunikasi VCOMM.
- Fitur chat 1-on-1 dan grup (teks, gambar, dokumen, voice note).
- Panggilan suara & video 1-on-1 serta grup via WebRTC.
- Autentikasi pengguna, manajemen profil, dan integrasi lisensi BLM.

---

## ⚙️ Prasyarat Lingkungan (Environment Prerequisites)

- **Sistem Operasi:** Windows / Linux / macOS (**Target build hanya Android**, tidak ada target iOS).
- **Node.js:** Versi ≥ 18.
- **Java Development Kit (JDK):** JDK 17 (disarankan Microsoft OpenJDK 17).
  - Pastikan path JDK sesuai dengan `org.gradle.java.home` di [android/gradle.properties](file:///c:/Development/VCOMM-Moblie/android/gradle.properties).
- **Android SDK:**
  - `compileSdkVersion`: 35
  - `targetSdkVersion`: 34
  - `minSdkVersion`: 24
  - `buildToolsVersion`: 35.0.0
  - **Android NDK:** `26.1.10909125` (wajib untuk modul `react-native-webrtc`).
  - Path SDK dikonfigurasi di `android/local.properties` (`sdk.dir=...`).

---

## 🚀 Menjalankan Aplikasi (Development)

1. **Instal Dependensi:**
   ```bash
   npm install
   ```
   *(Perintah ini akan otomatis menjalankan `patch-package` untuk memperbaiki receiver NetInfo pada Android 13/14).*

2. **Jalankan Metro Bundler:**
   ```bash
   npm start
   ```

3. **Jalankan ke Perangkat / Emulator Android:**
   Wajib menyertakan opsi `--mode` karena aplikasi memiliki flavor build:

   - **Varian VPN (VCOMM NXC VPN):**
     ```bash
     npx react-native run-android --mode vpnDebug
     ```
   - **Varian Standar (VCOMM Production):**
     ```bash
     npx react-native run-android --mode prodDebug
     ```

---

## 📦 Membangun APK Rilis (Build Release)

Eksekusi build APK dilakukan dari root project atau dari dalam folder `android/`:

- **Build APK Varian VPN:**
  ```powershell
  cd android
  .\gradlew.bat assembleVpnRelease
  ```
  *Output APK:* `android/app/build/outputs/apk/vpn/release/app-vpn-release.apk`

- **Build APK Varian Standar:**
  ```powershell
  cd android
  .\gradlew.bat assembleProdRelease
  ```
  *Output APK:* `android/app/build/outputs/apk/prod/release/app-prod-release.apk`

---

## 🧪 Validasi & QA Kode

Pastikan kode lulus verifikasi tipe dan linter sebelum rilis:

```bash
# Pengecekan tipe TypeScript
npx tsc --noEmit

# Linter kode
npm run lint

# Pengujian unit DNS Map Resolver
npm test -- __tests__/dnsMapResolver.test.ts
```
