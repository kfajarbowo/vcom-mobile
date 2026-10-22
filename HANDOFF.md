# HANDOFF — status kerja

> ⚠️ File ini **VOLATILE**: isinya kondisi kerja saat ini, bukan konvensi.
> Perbarui/tanggalkan saat tugas selesai. Aturan yang berlaku selamanya tetap
> di `AGENTS.md`.

Terakhir diperbarui: 2026-10-12 · branch: `badar-dev/fix-bug`

## Sedang dikerjakan

- Menyiapkan APK perbaikan yang bisa **menimpa** APK lapangan
  `VCOMM-06-03-2026` tanpa uninstall, agar lisensi yang tersimpan di
  app-private storage tidak hilang.

## Keputusan terkait

- `release` di `android/app/build.gradle` **sengaja** disign dengan
  `debug.keystore` (bukan `signingConfigs.release`). Ini yang membuat APK baru
  bisa menimpa APK terpasang; Android mewajibkan signature-nya sama.
- **Versioning dimulai:** `versionCode = 2`, `versionName = "1.1"`
  (`android/app/build.gradle:86-92`). Aturan: `versionCode` harus **naik**
  setiap rilis supaya update (menimpa) tetap diizinkan.

## Perubahan belum di-commit

- `android/app/build.gradle` — `versionCode`/`versionName` dinaikkan ke 2/"1.1";
  `release` disign `debug` (permanen, bukan sementara lagi).
- `android/gradle.properties` — `org.gradle.java.home` →
  `C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot`.

## Catatan

- Provider AI (`agentrouter`) sempat membalas `content-blocked` → sesi bisa
  terputus di tengah jalan. Simpan checkpoint penting di file, bukan hanya chat.
- `vcomm-release.keystore` + password tetap ada di repo (`gradle.properties`),
  tetapi **tidak dipakai** selama kebijakan sign-debug ini berlaku.

## Artefak APK

- `VCOMM-FIX-BUG-code1-20261012.apk` (root repo) — APK lama `versionCode=1`
  yang diamankan **sebelum** build, agar tidak hilang.
- `android/app/build/outputs/apk/release/app-release.apk` — hasil build baru
  (`versionCode=2`, `versionName="1.1"`), menimpa path yang sama.

## Langkah berikutnya

1. [x] Build APK release — **SELESAI** 2026-10-12 15:33. Perintah di branch ini
       adalah `.\gradlew.bat assembleRelease` dari `android/` — **BUKAN**
       `assembleProdRelease`, karena branch ini tidak punya `productFlavors`
       (hanya source set `debug` + `main`).
2. [ ] Uji menimpa APK terpasang (`VCOMM-06-03-2026`) di perangkat lapangan.
3. [ ] Pastikan lisensi tetap utuh setelah update.
4. [ ] Putuskan apakah kebijakan sign-debug dipertahankan jangka panjang atau
       hanya untuk siklus update ini.
