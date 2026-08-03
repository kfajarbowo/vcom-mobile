/**
 * Penerjemah hostname internal → IP, tanpa server DNS.
 *
 * Meniru mekanisme yang sudah terbukti di aplikasi EXE (`main.js`), memakai
 * berkas konfigurasi yang sama persis (`config/server-config.json`), dan
 * sejalan dengan implementasi di BMS serta BLM.
 *
 * Semua fungsi publik di sini `async` dan menunggu penyiapan selesai lebih
 * dulu, sehingga pemanggilnya tidak perlu tahu kapan startup rampung — cukup
 * `await`. Penyiapan itu sendiri hanya berjalan sekali.
 *
 * Lihat `.claude/dns-map-plan.md`.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import DeviceInfo from 'react-native-device-info';

import { DnsMapConfig, EMPTY_CONFIG, isEmptyConfig, loadConfig } from './config';
import { DnsMapResolver } from './resolver';
import { discoverBaseIp } from './bootstrap';

export { DnsMapResolver, applyOffset } from './resolver';
export { discoverBaseIp } from './bootstrap';
export type { DnsMapConfig } from './config';

/**
 * IP dasar site yang terakhir diketahui — padanan `lastSiteIp` di EXE.
 * Dari nilai ini seluruh hostname internal diturunkan lewat offset.
 */
const SITE_BASE_IP_KEY = 'vcomm_dns_map_site_base_ip';

/** Akhiran applicationId varian VPN, dari `applicationIdSuffix` di Gradle. */
const VPN_BUNDLE_SUFFIX = '.vpn';

let resolver = new DnsMapResolver(EMPTY_CONFIG);
let siteBaseIp: string | null = null;
let readyPromise: Promise<void> | null = null;

/**
 * Peta DNS hanya aktif di varian `vpn` (VCOMM NXC VPN).
 *
 * VCOMM existing sengaja dibiarkan apa adanya: di jaringan yang DNS-nya
 * berfungsi, penerjemahan hostname bisa mengarahkan aplikasi ke site yang
 * berbeda dari yang biasa diberikan DNS. Risiko itu tidak perlu ditanggung
 * perangkat yang selama ini sudah jalan.
 */
export const isDnsMapEnabled = (): boolean => {
  try {
    return DeviceInfo.getBundleId().endsWith(VPN_BUNDLE_SUFFIX);
  } catch (error) {
    console.warn('[DnsMap] Gagal membaca bundle id:', error);
    return false;
  }
};

const setup = async (): Promise<void> => {
  if (!isDnsMapEnabled()) {
    console.log('[DnsMap] Nonaktif untuk varian non-VPN');
    return;
  }

  const config: DnsMapConfig = loadConfig();
  resolver = new DnsMapResolver(config);
  if (isEmptyConfig(config)) {
    return;
  }

  try {
    // IP dasar dicari sekali saja lalu disimpan; balapan ke daftar kandidat
    // hanya berjalan kalau belum pernah ditemukan.
    const stored = await AsyncStorage.getItem(SITE_BASE_IP_KEY);
    if (stored) {
      siteBaseIp = stored;
      console.log(`[DnsMap] IP dasar tersimpan: ${stored}`);
      return;
    }

    siteBaseIp = await discoverBaseIp(resolver);
    if (siteBaseIp) {
      await AsyncStorage.setItem(SITE_BASE_IP_KEY, siteBaseIp);
    }
  } catch (error) {
    console.warn('[DnsMap] Gagal menyiapkan IP dasar:', error);
  }
};

/** Siapkan peta DNS; aman dipanggil berkali-kali, hanya berjalan sekali. */
export const ensureDnsMapReady = (): Promise<void> => {
  if (!readyPromise) {
    readyPromise = setup();
  }
  return readyPromise;
};

/**
 * Lupakan IP dasar yang tersimpan lalu cari ulang.
 *
 * Dipakai saat perangkat berpindah site — misalnya dibawa ke lokasi lain —
 * sehingga blok IP-nya berubah.
 */
export const resetSiteBaseIp = async (): Promise<string | null> => {
  await AsyncStorage.removeItem(SITE_BASE_IP_KEY);
  siteBaseIp = null;
  readyPromise = null;
  await ensureDnsMapReady();
  return siteBaseIp;
};

/** IP dasar site yang sedang dipakai, null bila belum diketahui. */
export const getSiteBaseIp = async (): Promise<string | null> => {
  await ensureDnsMapReady();
  return siteBaseIp;
};

/**
 * Terjemahkan satu nama host. Aman dipanggil pada host apa pun — nilai yang
 * sudah berupa IP tidak berubah.
 */
export const resolveHostname = async (host: string): Promise<string> => {
  await ensureDnsMapReady();
  return resolver.resolveHostname(host, siteBaseIp);
};

/** Terjemahkan satu URL utuh; skema, port, dan path dipertahankan. */
export const resolveUrl = async (url: string): Promise<string> => {
  await ensureDnsMapReady();
  return resolver.resolve(url, siteBaseIp);
};
