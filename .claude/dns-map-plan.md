# DNS Map — Menerjemahkan hostname internal tanpa server DNS

> Sudah terpasang di **BMS**, **BLM**, dan **VCOMM**. Berkas ini identik di
> ketiga repo — perbarui di satu tempat lalu salin. Ditulis netral-bahasa;
> bagian yang berbeda per aplikasi hanya **appKey** dan **adapter storage/HTTP**
> — lihat §6.

---

## 1. Masalah

Jaringan lapangan **tidak punya server DNS**. Hostname internal
(`bms.id`, `chat.id`, `blm.id`, `map.id`) hanya bisa di-resolve kalau ada yang
menerjemahkannya.

Dulu aplikasi mobile bekerja karena **SIM khusus Nexxuz** membawa DNS internal
lewat APN-nya. Begitu SIM diganti komersial dan koneksi pindah ke Wi-Fi khusus
(yang tunnel VPN-nya ada di router), rute tetap ada tapi **DNS-nya hilang** —
dan seluruh aplikasi mobile berhenti bisa menjangkau server.

Bukti yang mengunci diagnosis:

| Skenario | Rute | DNS | Hasil |
|---|---|---|---|
| SIM Nexxuz langsung di HP | ✓ APN | ✓ APN | jalan |
| Hotspot dari HP ber-SIM Nexxuz | ✓ via induk | ✓ via induk | jalan |
| Laptop EXE di Wi-Fi khusus | ✓ VPN router | ✓ **dikonfigurasi sendiri** | jalan |
| HP di Wi-Fi khusus | ✓ VPN router | ✗ tidak ada | **gagal** |

Browser di HP bisa membuka `http://<IP>:<port>` — membuktikan jaringannya sehat
dan yang hilang memang penerjemah namanya.

Komentar di `main.js` aplikasi EXE menyebutnya eksplisit:

> *"Web app uses DNS hostnames (eyesee.id) in .env, but clients **without a DNS
> server** (e.g. Starlink) can't resolve them."*

## 2. Solusi: meniru EXE

Aplikasi EXE menyelesaikannya dengan **memalsukan DNS di sisi klien**. Kita
meniru mekanisme yang sama, memakai **berkas konfigurasi yang sama persis**.

| EXE (`main.js`) | Mobile |
|---|---|
| `server-config.json` | berkas yang **sama**, disalin ke asset aplikasi |
| injeksi `--host-resolver-rules` ke Chromium | *tidak ada padanan — tidak dibutuhkan* |
| `resolveDnsMapUrl(url, baseIp)` | `DnsMapResolver.resolve()` |
| `Promise.any(fallbackApiUrls)` | `DnsMapBootstrap.discoverBaseIp()` |
| `siteStore.get('lastSiteIp')` | `pref.getSiteBaseIp()` |

EXE butuh dua jalur karena Chromium punya mesin DNS sendiri. Flutter dan React
Native tidak — **semua URL melewati satu titik inisialisasi**, jadi satu
penerjemahan di sana sudah menutup API, socket, tiles, dan license sekaligus.

## 3. Berkas konfigurasi

`config/server-config.json` — salinan identik milik EXE:

```json
{
  "siteApiUrl": "http://blm.id:3003/api/v1/apps/eyesee",
  "fallbackApiUrls": [
    "http://172.27.100.5:3003/api/v1/apps/eyesee",
    "http://172.27.100.69:3003/api/v1/apps/eyesee",
    "http://172.27.100.133:3003/api/v1/apps/eyesee",
    "http://172.16.9.4:3003/api/v1/apps/eyesee"
  ],
  "dnsMap": {
    "eyesee.id": 0, "blm.id": -1, "bms.id": -2, "map.id": -3,
    "storage.id": 1, "chat.id": 2, "local.id": -1
  }
}
```

**Pertahankan identik** dengan punya EXE, termasuk field yang tidak dipakai
(`webviewUrl`), supaya bisa disalin bolak-balik tanpa penyesuaian. Kalau tim
server memperbaruinya, timpa berkas di aplikasi juga — ini harus masuk
kebiasaan rilis.

## 4. Cara kerja offset

`dnsMap` berisi **offset oktet terakhir**, relatif terhadap **IP dasar site**
(yaitu IP `eyesee.id`, offset `0`):

```
map.id = dasar−3   bms.id = dasar−2   blm.id = dasar−1
eyesee.id = dasar  storage.id = dasar+1   chat.id = dasar+2
```

Contoh untuk tiga site yang terdaftar:

| Site | map.id | bms.id | blm.id | eyesee | chat.id |
|---|---|---|---|---|---|
| KEMHAN-PUSDATIN | `172.27.100.3` | `.4` | `.5` | `.6` | `.8` |
| KEMHAN-MM | `.67` | `.68` | `.69` | `.70` | `.72` |
| BSSN-RAGUNAN | `.131` | `.132` | `.133` | `.134` | `.136` |

Tata letak ini **identik** dengan `master-data-ip-trizien-vercel.txt` lama
(SITE-01: maps `.3`, BMS `.4`, BLM `.5`, EYESEE `.6`, storage `.7`, chat `.8`).
Konvensi dalam blok tidak pernah berubah — hanya alamat pangkalnya bergeser
dari `172.27.0.x` (jarak 32) ke `172.27.100.x` (jarak 64). Itu sebabnya berkas
master data lama tidak pernah bisa menemukan site-site ini.

## 5. Alur

```
init
  ├─ muat server-config.json  (dnsMap + fallbackApiUrls)
  ├─ ada siteBaseIp tersimpan?
  │     ya  ─▶ pakai
  │     tidak ─▶ balapan seluruh fallbackApiUrls serentak
  │              pemenang = host blm.id → dasar = IP + 1 → simpan
  ├─ tukar hostname → IP pada seluruh URL env
  └─ set global / storage seperti biasa
```

Dua aturan yang tidak boleh dilonggarkan:

1. **Balapan, bukan bergiliran.** Kandidat mati menggantung sampai timeout;
   sekuensial berarti menunggu berkali-kali lipat di jalur startup.
2. **Kandidat divalidasi isinya**, bukan sekadar terjangkau — harus `200` +
   body berisi daftar site. Host yang kebetulan membuka port 3003 tapi bukan
   master akan membuat **seluruh alamat turunan salah**, dan itu jauh lebih
   sulit dilacak daripada gagal terang-terangan.

## 6. Yang berbeda per aplikasi

| | BMS | BLM | VCOMM |
|---|---|---|---|
| Hostname utama | `bms.id` (−2) | `blm.id` (−1) | `chat.id` (+2) |
| Bahasa | Dart | Dart | TypeScript |
| Storage | `SharedPrefHelper` | `SharedPreferences` | `AsyncStorage` |
| HTTP | `Dio` | `package:http` | `fetch` |
| Muat asset | `rootBundle` | `rootBundle` | `require()` / bundel JSON |
| Titik cegat | `di.init` | inisialisasi `utils/config.dart` | `getApiBaseUrl()` di `apiClient.ts` |

Selebihnya identik. Offset **tidak perlu dihitung ulang** — semuanya sudah ada
di `dnsMap`.

### Catatan khusus VCOMM — ✅ SELESAI

VCOMM sudah punya separuh jalannya: `getApiBaseUrl()` membaca host dari
`AsyncStorage`, dan layar Login/Settings punya pemilih host yang menyimpan
**IP mentah** — sehingga DNS terlewati begitu operator memilih site.

Yang belum: daftar site-nya di-fetch dari `blm.id:3003` (hostname lagi), jadi
saat DNS mati dropdown-nya kosong dan yang tersisa cuma tombol **RETRY FETCH**
yang akan gagal terus. Porting DNS Map menutup lubang itu, sekaligus membuat
default `chat.id` bekerja tanpa operator perlu memilih apa pun.

Hasil: `src/utils/dnsMap/` (4 berkas), 24 test di
`__tests__/dnsMapResolver.test.ts`.

Tiga penyesuaian yang khas React Native:

- **`resolveHostname(host)` selain `resolve(url)`.** VCOMM menyimpan host dan
  port **terpisah** di AsyncStorage, jadi bentuk per-host itulah yang paling
  sering dipakai. Versi URL utuh tetap ada untuk `siteService`.
- **Parsing URL memakai regex, bukan `new URL()`.** Implementasi `URL` bawaan
  React Native tidak lengkap dan perilakunya berbeda antar versi.
- **Semua fungsi publik `async` dan menunggu `ensureDnsMapReady()`.** Tidak ada
  padanan `di.init` yang menahan startup di RN, jadi kesiapan dijamin lewat satu
  promise yang di-memo; pemanggil cukup `await`. `App.tsx` memicunya lebih dulu
  agar balapan berjalan berbarengan dengan boot.

Empat titik cegat, semuanya sudah `async` sejak awal:

| Berkas | Fungsi |
|---|---|
| `services/apiClient.ts` | `getApiBaseUrl()` — API, WebSocket, upload |
| `services/licenseService.ts` | `getLicenseServerUrl()` |
| `services/webrtcConfig.ts` | `getIceServers()` — **TURN juga**, `turn:chat.id:3478` tidak bisa di-resolve tanpa DNS |
| `services/siteService.ts` | `fetchCustomSites()` — master data `blm.id:3003` |

**Flavor `vpn`** ditambahkan (`android/app/build.gradle`):
`applicationIdSuffix ".vpn"` → `com.vcommmobile.vpn`, nama app
**"VCOMM NXC VPN"** lewat `android/app/src/vpn/res/values/strings.xml`
(source set, bukan `resValue` — `app_name` sudah ada di `src/main`, dan
keduanya bersamaan menimbulkan duplicate resource).

Karena sebelumnya VCOMM **tidak punya flavor sama sekali**, kini ada dua —
`prod` (identitas persis seperti sebelumnya) dan `vpn`. Konsekuensinya:

```
npx react-native run-android --mode prodDebug      # dev seperti biasa
cd android && ./gradlew assembleProdRelease        # existing
cd android && ./gradlew assembleVpnRelease         # VCOMM NXC VPN
```

`react { debuggableVariants = ["prodDebug", "vpnDebug"] }` **wajib** diset —
bawaannya `["debug"]` yang sudah tidak ada lagi setelah flavor ditambahkan,
sehingga build debug akan mencoba membundel JS dan gagal terhubung ke Metro.

**Gating:** sama seperti BLM, hanya aktif di varian VPN. Deteksinya lewat
`DeviceInfo.getBundleId().endsWith('.vpn')` — RN tidak punya `appFlavor` seperti
Flutter, dan `react-native-device-info` sudah jadi dependensi.

**Efek samping yang ikut ditutup:** broadcast
`com.vcommmobile.CLOSE_INCOMING_CALL_ACTIVITY` dikirim implisit di tiga tempat.
Dengan dua varian terpasang berdampingan, broadcast itu bisa menutup layar
panggilan masuk milik aplikasi sebelah (di bawah Android 13 receiver runtime
masih exported secara bawaan). Ditambahkan `.setPackage(packageName)`.

### Catatan khusus BLM — ✅ SELESAI

BLM memakai `blm.id` yang offsetnya `-1` — **sama dengan host master data**.
Jadi IP dasar hasil balapan langsung memberi alamat aplikasinya sendiri.

Hasil: `lib/utils/dns_map/` (4 berkas, adapter `package:http` + `debugPrint`),
titik cegat di `Config.initialize()`, URL master di `server_config_sheet.dart`
ikut diterjemahkan, 18 test di `test/dns_map_resolver_test.dart`.

Dua temuan saat porting:

- **`config/` tidak pernah terdaftar sebagai asset di `pubspec.yaml`**, sehingga
  `dotenv.load('config/.env.prod')` **selalu** melempar dan `catch` diam-diam
  memakai nilai hardcoded di `config.dart`. Berkas `.env` di BLM tidak pernah
  terbaca sama sekali. Setelah `config/` didaftarkan (wajib, agar
  `server-config.json` bisa dimuat), berkas `.env` **mulai benar-benar
  berpengaruh** — periksa isinya sebelum rilis.
- **`resetServerToDefault()`** mengembalikan server ke `http://blm.id` mentah.
  Diperbaiki dengan membuat `Config.updateServerUrl()` ikut menerjemahkan.

**Flavor `vpn`** ditambahkan (`build.gradle.kts`): `applicationIdSuffix ".vpn"`
→ `com.nexxuzasia.blm.blm_ops.vpn`, nama app **"BLM NXC VPN"**, terpasang
berdampingan dengan BLM existing. `android:label` diubah dari hardcoded `"BLM"`
menjadi `@string/app_name`. BLM tidak memakai Firebase, jadi tidak ada urusan
`google-services.json`.

Karena sebelumnya BLM **tidak punya flavor sama sekali**, kini ada dua —
`prod` (identitas persis seperti sebelumnya) dan `vpn`. Konsekuensinya perintah
build wajib menyertakan flavor:

```
flutter build apk --release --flavor prod   # existing
flutter build apk --release --flavor vpn    # BLM NXC VPN
```

> **DNS Map di BLM di-gate ke flavor `vpn`** lewat `appFlavor == 'vpn'`.
> BLM existing sengaja dibiarkan apa adanya, karena di jaringan yang DNS-nya
> berfungsi penerjemahan hostname bisa mengarahkan aplikasi ke site yang
> berbeda dari yang biasa diberikan DNS — risiko yang tidak perlu ditanggung
> perangkat yang selama ini sudah jalan.
>
> **Catatan konsistensi:** di BMS, DNS Map **tidak** di-gate — ia aktif di semua
> flavor. Perbedaan ini disengaja dan diketahui; kalau ingin seragam, BMS bisa
> ikut di-gate dengan cara yang sama.

## 7. Implementasi BMS (rujukan)

`package/core/lib/src/service/dns_map/`

| Berkas | Isi |
|---|---|
| `dns_map_config.dart` | Model + loader `server-config.json`. `fallbackHostname` diturunkan dari host `siteApiUrl`, jadi tidak ada nilai yang perlu dikonfigurasi dua kali |
| `dns_map_resolver.dart` | `resolve(url, baseIp)`, `baseIpFrom(serviceIp, hostname)`, `applyOffset(ip, offset)` |
| `dns_map_bootstrap.dart` | Balapan kandidat, validasi isi, turunkan IP dasar |
| `dns_map.dart` | Barrel |

Wiring: satu key prefs (`dnsMapSiteBaseIp`) + satu blok di
`injection_container.dart` sebelum global URL diset. **Picker, sheet, splash,
dan bloc tidak tersentuh.**

Test: `package/core/test/dns_map/` — 17 test, mengunci perhitungan offset
terhadap data nyata dari `server-config.json`.

## 8. Keputusan yang diambil (dan alasannya)

- **License ikut diterjemahkan.** Halaman Server Configuration sengaja tidak
  pernah menyentuh `licenseServerUrl`, sehingga nilainya **selalu** bertahan
  sebagai hostname. Tanpa penerjemahan, license tidak akan pernah terhubung
  tanpa DNS, apa pun site yang dipilih.
- **`siteBaseIp` tidak ikut berubah saat user ganti site.** Site yang dipilih
  sudah memberi IP konkret untuk API/socket/tiles, jadi tidak butuh terjemahan.
  Membiarkan `siteBaseIp` tetap menunjuk master yang terbukti hidup mencegah
  bug lama kambuh: *ganti site → terlempar ke halaman license*.
- **Host yang sudah berupa IP tidak tersentuh**, karena tidak ada di `dnsMap`.
  Aman dipanggil pada URL apa pun.
- **Gagal itu senyap dan tidak fatal.** Config hilang/rusak → resolver jadi
  no-op, aplikasi tetap jalan dengan hostname apa adanya.

## 9. Yang belum terverifikasi

- [ ] Balapan kandidat terhadap server sungguhan (baru diuji terhadap logika)
- [ ] Apakah master melayani appKey selain `eyesee` — EXE hanya membuktikan
      `/api/v1/apps/eyesee`. Untuk **discovery IP dasar**, `eyesee` justru
      pilihan paling aman karena terbukti terisi; appKey aplikasi sendiri baru
      relevan saat mengambil daftar site.
- [ ] Port aplikasi di blok `172.27.100.x` (BMS `8502` diasumsikan sama)
- [ ] Apakah masih ada penghalang khusus aplikasi — **proxy Wi-Fi** (browser
      patuh, Dio/fetch tidak) atau **pembatasan jaringan per-app di MIUI**.
      Dua ini belum pernah diuji dan tetap bisa menjelaskan "browser bisa,
      aplikasi tidak".

## 10. Cara membaca hasil uji lapangan

Cari penanda ini di logcat:

| Log | Artinya |
|---|---|
| `[DnsMap] Master hidup: … → IP dasar …` | balapan berhasil, DNS teratasi |
| `[DnsMap] <host> → <ip>` | penerjemahan jalan |
| `[DnsMap] Semua kandidat master tidak menjawab` | keempat IP tak terjangkau — kembali ke persoalan rute |

Kalau baris terakhir muncul **padahal browser bisa membuka IP yang sama**,
tersangkanya tinggal proxy Wi-Fi atau pembatasan per-app.
