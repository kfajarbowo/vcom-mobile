/**
 * Mencari IP dasar site saat aplikasi belum tahu apa pun.
 *
 * Padanan blok `get-sites` di `main.js` aplikasi EXE: seluruh `fallbackApiUrls`
 * dicoba **serentak**, yang pertama menjawab valid menang.
 *
 * Dari URL pemenang, IP dasar diturunkan lewat `baseIpFrom()` — host
 * `siteApiUrl` (`blm.id`) memberi tahu offset mana yang berlaku, jadi tidak ada
 * nilai yang perlu dikonfigurasi terpisah.
 */

import { fallbackHostname, hostOf } from './config';
import { DnsMapResolver } from './resolver';

/**
 * Batas waktu satu kandidat. Pendek, karena seluruh kandidat berjalan bersamaan
 * dan ini terjadi di jalur startup.
 */
export const DEFAULT_TIMEOUT_MS = 3000;

/**
 * Kandidat dianggap sah hanya bila membalas `200` **dan** bodinya berisi daftar
 * site — sekadar terjangkau tidak cukup, karena host yang kebetulan membuka
 * port 3003 akan membuat seluruh alamat turunannya salah.
 */
const isLiveMaster = async (
  url: string,
  timeoutMs: number,
): Promise<boolean> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (response.status !== 200) {
      return false;
    }

    const data = await response.json();
    const sites = data?.data?.sites;
    return Array.isArray(sites) && sites.length > 0;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Jalankan seluruh kandidat bersamaan, ambil yang pertama valid.
 *
 * `Promise.any` tidak dipakai supaya kandidat yang gagal tidak perlu melempar,
 * dan supaya nilai null (semua gagal) tetap bisa dikembalikan dengan rapi.
 */
const race = (candidates: string[], timeoutMs: number): Promise<string | null> =>
  new Promise(resolve => {
    let pending = candidates.length;
    let settled = false;

    const finish = (winner: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(winner);
    };

    for (const url of candidates) {
      isLiveMaster(url, timeoutMs).then(ok => {
        if (ok) {
          finish(url);
          return;
        }
        pending -= 1;
        if (pending === 0) {
          finish(null);
        }
      });
    }
  });

/** Cari IP dasar site. Null bila tidak ada kandidat yang menjawab. */
export const discoverBaseIp = async (
  resolver: DnsMapResolver,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<string | null> => {
  const candidates = resolver.config.fallbackApiUrls;
  const hostname = fallbackHostname(resolver.config);

  if (candidates.length === 0 || !hostname) {
    console.log('[DnsMap] Tidak ada kandidat master untuk menentukan IP dasar');
    return null;
  }

  const winner = await race(candidates, timeoutMs);
  if (!winner) {
    console.log('[DnsMap] Semua kandidat master tidak menjawab');
    return null;
  }

  const serviceIp = hostOf(winner);
  if (!serviceIp) {
    return null;
  }

  const baseIp = resolver.baseIpFrom(serviceIp, hostname);
  console.log(
    `[DnsMap] Master hidup: ${serviceIp} (${hostname}) → IP dasar ${baseIp}`,
  );
  return baseIp;
};
