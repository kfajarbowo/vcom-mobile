/**
 * Isi `config/server-config.json` — salinan identik milik aplikasi EXE.
 *
 * Dipertahankan sama persis supaya satu berkas bisa dipakai bersama: kalau tim
 * server memperbarui punya EXE, berkas di sini tinggal ditimpa apa adanya.
 * Field yang tidak dipakai aplikasi mobile (`webviewUrl`) sengaja dibiarkan ada
 * agar berkasnya tetap bisa disalin bolak-balik tanpa penyesuaian.
 *
 * Lihat `.claude/dns-map-plan.md`.
 */

// Metro membundel JSON secara bawaan, jadi berkasnya ikut masuk ke bundle
// tanpa perlu didaftarkan sebagai asset.
import rawConfig from '../../../config/server-config.json';

export interface DnsMapConfig {
  /** Nama host → offset terhadap IP dasar site. */
  dnsMap: Record<string, number>;
  /** URL master data versi hostname, misal `http://blm.id:3003/...`. */
  siteApiUrl: string;
  /** Daftar URL master versi IP, dicoba serentak saat IP dasar belum diketahui. */
  fallbackApiUrls: string[];
}

export const EMPTY_CONFIG: DnsMapConfig = {
  dnsMap: {},
  siteApiUrl: '',
  fallbackApiUrls: [],
};

export const isEmptyConfig = (config: DnsMapConfig): boolean =>
  Object.keys(config.dnsMap).length === 0;

/**
 * Nama host yang diwakili oleh `fallbackApiUrls`.
 *
 * Diturunkan dari `siteApiUrl` — karena daftar fallback memang versi IP dari
 * URL yang sama — sehingga tidak perlu dikonfigurasi terpisah.
 */
export const fallbackHostname = (config: DnsMapConfig): string | null =>
  hostOf(config.siteApiUrl);

/**
 * Ambil bagian host dari sebuah URL.
 *
 * Dikerjakan manual dengan regex, bukan `new URL()`: implementasi `URL` bawaan
 * React Native tidak lengkap dan perilakunya berbeda antar versi.
 */
export const hostOf = (url: string): string | null => {
  const parts = splitUrl(url);
  return parts ? parts.host : null;
};

export interface UrlParts {
  /** Skema + `://`, misal `http://`. */
  scheme: string;
  /** `user:pass@` bila ada, selain itu string kosong. */
  userInfo: string;
  host: string;
  /** `:5000` bila ada, selain itu string kosong. */
  port: string;
  /** Sisa URL setelah authority: path, query, fragment. */
  rest: string;
}

const URL_PATTERN = /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/?#]*)([\s\S]*)$/;

/** Pecah URL menjadi bagian-bagiannya; null bila bukan URL berskema. */
export const splitUrl = (url: string): UrlParts | null => {
  const match = URL_PATTERN.exec(url);
  if (!match) {
    return null;
  }

  const [, scheme, authority, rest] = match;

  const at = authority.lastIndexOf('@');
  const userInfo = at >= 0 ? authority.slice(0, at + 1) : '';
  const hostPort = at >= 0 ? authority.slice(at + 1) : authority;

  // IPv6 (`[::1]:80`) tidak dipakai di jaringan ini, tapi tetap dijaga agar
  // titik dua di dalam kurung siku tidak salah dibaca sebagai pemisah port.
  const colon = hostPort.startsWith('[')
    ? hostPort.indexOf(':', hostPort.indexOf(']'))
    : hostPort.indexOf(':');

  const host = colon >= 0 ? hostPort.slice(0, colon) : hostPort;
  const port = colon >= 0 ? hostPort.slice(colon) : '';

  return { scheme, userInfo, host, port, rest };
};

/** Baca konfigurasi dari JSON apa adanya, tahan terhadap field yang hilang. */
export const parseConfig = (json: unknown): DnsMapConfig => {
  if (!json || typeof json !== 'object') {
    return EMPTY_CONFIG;
  }

  const source = json as Record<string, unknown>;

  const dnsMap: Record<string, number> = {};
  const rawMap = source.dnsMap;
  if (rawMap && typeof rawMap === 'object') {
    for (const [host, value] of Object.entries(rawMap)) {
      const offset = typeof value === 'number' ? value : Number(value);
      if (Number.isInteger(offset)) {
        dnsMap[host] = offset;
      }
    }
  }

  const rawFallback = source.fallbackApiUrls;
  const fallbackApiUrls = Array.isArray(rawFallback)
    ? rawFallback.map(item => String(item).trim()).filter(item => item.length > 0)
    : [];

  return {
    dnsMap,
    siteApiUrl:
      typeof source.siteApiUrl === 'string' ? source.siteApiUrl : '',
    fallbackApiUrls,
  };
};

/**
 * Konfigurasi yang terbaca dari berkas. Berkas rusak atau tidak ada tidak
 * mematikan aplikasi — hanya membuat penerjemahan hostname tidak aktif.
 */
export const loadConfig = (): DnsMapConfig => {
  try {
    return parseConfig(rawConfig);
  } catch (error) {
    console.warn('[DnsMap] Gagal membaca config/server-config.json:', error);
    return EMPTY_CONFIG;
  }
};
