/**
 * Menerjemahkan hostname internal (`chat.id`, `blm.id`, …) menjadi IP, tanpa
 * server DNS sama sekali.
 *
 * Padanan TypeScript dari `resolveDnsMapUrl()` di `main.js` aplikasi EXE, dan
 * kembaran dari implementasi yang sudah jalan di BMS dan BLM.
 *
 * Alasannya: jaringan lapangan **tidak punya server DNS**. Dulu hostname bisa
 * resolve karena SIM khusus membawa DNS internal lewat APN-nya; begitu
 * koneksinya pindah ke Wi-Fi khusus, penopang itu hilang dan seluruh hostname
 * `.id` berhenti bisa diterjemahkan.
 *
 * Lihat `.claude/dns-map-plan.md`.
 */

import { DnsMapConfig, isEmptyConfig, splitUrl } from './config';

/**
 * Geser oktet terakhir `ip` sebanyak `offset`.
 *
 * Mengikuti persis cara EXE: hanya oktet keempat yang digeser, tanpa perambatan
 * ke oktet sebelumnya. Aman karena tiap site menempati satu blok dan seluruh
 * layanannya berada di oktet yang sama.
 */
export const applyOffset = (ip: string, offset: number): string | null => {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    return null;
  }

  const octets: number[] = [];
  for (const part of parts) {
    // `Number('')` bernilai 0, jadi bagian kosong perlu ditolak lebih dulu.
    if (!/^\d+$/.test(part)) {
      return null;
    }
    const value = Number(part);
    if (value > 255) {
      return null;
    }
    octets.push(value);
  }

  const last = octets[3] + offset;
  if (last < 0 || last > 255) {
    return null;
  }

  octets[3] = last;
  return octets.join('.');
};

export class DnsMapResolver {
  constructor(readonly config: DnsMapConfig) {}

  get dnsMap(): Record<string, number> {
    return this.config.dnsMap;
  }

  /**
   * Tukar satu nama host dengan IP-nya, dihitung dari `baseIp` + offset.
   *
   * VCOMM menyimpan host dan port terpisah di AsyncStorage, jadi bentuk inilah
   * yang paling sering dipakai — bukan versi URL utuh.
   *
   * Nilai dikembalikan apa adanya bila: dnsMap kosong, `baseIp` belum
   * diketahui, atau host-nya tidak terdaftar. Host yang sudah berupa IP tidak
   * tersentuh karena tidak ada di dnsMap.
   */
  resolveHostname(host: string, baseIp: string | null): string {
    if (!host || !baseIp || isEmptyConfig(this.config)) {
      return host;
    }

    const offset = this.dnsMap[host];
    if (offset === undefined) {
      return host;
    }

    const resolved = applyOffset(baseIp, offset);
    if (!resolved) {
      return host;
    }

    console.log(`[DnsMap] ${host} → ${resolved}`);
    return resolved;
  }

  /**
   * Tukar hostname pada `url` dengan IP. Skema, port, path, dan query
   * dipertahankan.
   */
  resolve(url: string, baseIp: string | null): string {
    if (!url || !baseIp || isEmptyConfig(this.config)) {
      return url;
    }

    const parts = splitUrl(url);
    if (!parts) {
      return url;
    }

    const resolvedHost = this.resolveHostname(parts.host, baseIp);
    if (resolvedHost === parts.host) {
      return url;
    }

    return `${parts.scheme}${parts.userInfo}${resolvedHost}${parts.port}${parts.rest}`;
  }

  /**
   * Hitung IP dasar site dari IP sebuah layanan yang sudah diketahui.
   *
   * Kebalikan dari `applyOffset`. Dipakai saat aplikasi baru mengetahui IP satu
   * layanan — misalnya IP master dari pemenang balapan — lalu perlu menurunkan
   * sisanya.
   */
  baseIpFrom(serviceIp: string, hostname: string): string | null {
    const offset = this.dnsMap[hostname];
    if (offset === undefined) {
      return null;
    }
    return applyOffset(serviceIp, -offset);
  }
}
