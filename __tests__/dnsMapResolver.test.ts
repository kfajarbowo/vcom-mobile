/**
 * Diambil dari test yang sama di BMS dan BLM, memakai nilai asli
 * config/server-config.json milik EXE.
 */

// Sama seperti App.test.tsx: diimpor eksplisit agar memakai tipe bawaan jest.
import { describe, expect, it } from '@jest/globals';

import {
  DnsMapConfig,
  fallbackHostname,
  hostOf,
  parseConfig,
  splitUrl,
} from '../src/utils/dnsMap/config';
import { DnsMapResolver, applyOffset } from '../src/utils/dnsMap/resolver';

const config: DnsMapConfig = {
  dnsMap: {
    'eyesee.id': 0,
    'blm.id': -1,
    'bms.id': -2,
    'map.id': -3,
    'storage.id': 1,
    'chat.id': 2,
    'local.id': -1,
  },
  siteApiUrl: 'http://blm.id:3003/api/v1/apps/eyesee',
  fallbackApiUrls: [
    'http://172.27.100.5:3003/api/v1/apps/eyesee',
    'http://172.27.100.69:3003/api/v1/apps/eyesee',
  ],
};

const resolver = new DnsMapResolver(config);

// KEMHAN-PUSDATIN: blm.id = 172.27.100.5, jadi IP dasarnya .6
const baseIp = '172.27.100.6';

describe('DnsMapResolver.resolveHostname', () => {
  it('menerjemahkan host yang dipakai VComm', () => {
    // chat.id offset +2 — server VComm sendiri
    expect(resolver.resolveHostname('chat.id', baseIp)).toBe('172.27.100.8');
    // blm.id offset -1 — master data & license server
    expect(resolver.resolveHostname('blm.id', baseIp)).toBe('172.27.100.5');
  });

  it('host yang sudah berupa IP tidak tersentuh', () => {
    // Site yang dipilih user sudah berupa IP konkret — tidak boleh berubah.
    expect(resolver.resolveHostname('172.27.100.69', baseIp)).toBe(
      '172.27.100.69',
    );
  });

  it('host di luar dnsMap tidak tersentuh', () => {
    expect(resolver.resolveHostname('example.com', baseIp)).toBe('example.com');
  });

  it('tanpa IP dasar, host dikembalikan apa adanya', () => {
    expect(resolver.resolveHostname('chat.id', null)).toBe('chat.id');
    expect(resolver.resolveHostname('chat.id', '')).toBe('chat.id');
  });

  it('tiga site di server-config menghasilkan IP chat yang benar', () => {
    expect(resolver.resolveHostname('chat.id', '172.27.100.6')).toBe(
      '172.27.100.8',
    );
    expect(resolver.resolveHostname('chat.id', '172.27.100.70')).toBe(
      '172.27.100.72',
    );
    expect(resolver.resolveHostname('chat.id', '172.27.100.134')).toBe(
      '172.27.100.136',
    );
  });
});

describe('DnsMapResolver.resolve', () => {
  it('skema, port, dan path dipertahankan', () => {
    expect(resolver.resolve('http://chat.id:5000', baseIp)).toBe(
      'http://172.27.100.8:5000',
    );
    expect(
      resolver.resolve('http://blm.id:3003/api/v1/apps/chat', baseIp),
    ).toBe('http://172.27.100.5:3003/api/v1/apps/chat');
    expect(resolver.resolve('ws://chat.id:5000/ws', baseIp)).toBe(
      'ws://172.27.100.8:5000/ws',
    );
    // offset 0 — memetakan tepat ke IP dasar site
    expect(resolver.resolve('http://eyesee.id:3000/', baseIp)).toBe(
      'http://172.27.100.6:3000/',
    );
  });

  it('query dan fragment ikut utuh', () => {
    expect(resolver.resolve('http://chat.id:5000/a?b=1#c', baseIp)).toBe(
      'http://172.27.100.8:5000/a?b=1#c',
    );
  });

  it('URL tanpa port tetap tanpa port', () => {
    expect(resolver.resolve('http://blm.id', baseIp)).toBe('http://172.27.100.5');
  });

  it('host yang sudah berupa IP tidak tersentuh', () => {
    const url = 'http://172.27.100.69:5000';
    expect(resolver.resolve(url, baseIp)).toBe(url);
  });

  it('dnsMap kosong tidak mengubah apa pun', () => {
    const empty = new DnsMapResolver({
      dnsMap: {},
      siteApiUrl: '',
      fallbackApiUrls: [],
    });
    expect(empty.resolve('http://chat.id', baseIp)).toBe('http://chat.id');
  });

  it('URL rusak dikembalikan apa adanya', () => {
    expect(resolver.resolve('bukan url sama sekali', baseIp)).toBe(
      'bukan url sama sekali',
    );
    expect(resolver.resolve('', baseIp)).toBe('');
  });
});

describe('DnsMapResolver.baseIpFrom', () => {
  it('menurunkan IP dasar dari IP master yang menang', () => {
    expect(resolver.baseIpFrom('172.27.100.5', 'blm.id')).toBe('172.27.100.6');
    expect(resolver.baseIpFrom('172.27.100.69', 'blm.id')).toBe('172.27.100.70');
    expect(resolver.baseIpFrom('172.27.100.133', 'blm.id')).toBe(
      '172.27.100.134',
    );
    expect(resolver.baseIpFrom('172.16.9.4', 'blm.id')).toBe('172.16.9.5');
  });

  it('bolak-balik konsisten dengan resolve()', () => {
    const base = resolver.baseIpFrom('172.27.100.69', 'blm.id');
    expect(resolver.resolve('http://blm.id', base)).toBe('http://172.27.100.69');
  });

  it('hostname tak dikenal menghasilkan null', () => {
    expect(resolver.baseIpFrom('172.27.100.5', 'entah.id')).toBeNull();
  });
});

describe('applyOffset', () => {
  it('menggeser oktet terakhir', () => {
    expect(applyOffset('172.27.100.6', -1)).toBe('172.27.100.5');
    expect(applyOffset('172.27.100.6', 2)).toBe('172.27.100.8');
    expect(applyOffset('172.27.100.6', 0)).toBe('172.27.100.6');
  });

  it('menolak hasil di luar batas oktet', () => {
    expect(applyOffset('172.27.100.0', -1)).toBeNull();
    expect(applyOffset('172.27.100.254', 5)).toBeNull();
  });

  it('menolak IP yang tidak sah', () => {
    expect(applyOffset('172.27.100', -1)).toBeNull();
    expect(applyOffset('bukan.ip.sama.sekali', -1)).toBeNull();
    expect(applyOffset('172.27.100.', -1)).toBeNull();
    expect(applyOffset('172.27.100.999', 0)).toBeNull();
  });
});

describe('splitUrl', () => {
  it('memisahkan host dari port dan path', () => {
    expect(splitUrl('http://chat.id:5000/ws')).toEqual({
      scheme: 'http://',
      userInfo: '',
      host: 'chat.id',
      port: ':5000',
      rest: '/ws',
    });
  });

  it('menangani userinfo', () => {
    const parts = splitUrl('http://user:pass@chat.id:5000/x');
    expect(parts?.host).toBe('chat.id');
    expect(parts?.userInfo).toBe('user:pass@');
  });

  it('menolak string tanpa skema', () => {
    expect(splitUrl('chat.id:5000')).toBeNull();
  });
});

describe('parseConfig', () => {
  it('membaca berkas milik EXE apa adanya', () => {
    const parsed = parseConfig({
      _project: 'ALL SITES — EyeSee',
      webviewUrl: 'http://eyesee.id:3000/',
      siteApiUrl: 'http://blm.id:3003/api/v1/apps/eyesee',
      fallbackApiUrls: [
        'http://172.27.100.5:3003/api/v1/apps/eyesee',
        'http://172.16.9.4:3003/api/v1/apps/eyesee',
      ],
      dnsMap: { 'blm.id': -1, 'bms.id': -2 },
    });

    expect(parsed.dnsMap['blm.id']).toBe(-1);
    expect(parsed.fallbackApiUrls).toHaveLength(2);
  });

  it('hostname fallback diturunkan dari siteApiUrl', () => {
    expect(fallbackHostname(config)).toBe('blm.id');
    expect(hostOf('http://172.27.100.5:3003/api')).toBe('172.27.100.5');
  });

  it('JSON tanpa dnsMap menghasilkan config kosong', () => {
    expect(Object.keys(parseConfig({}).dnsMap)).toHaveLength(0);
    expect(fallbackHostname(parseConfig({}))).toBeNull();
  });
});

describe('berkas config/server-config.json yang sebenarnya', () => {
  it('terbaca dan berisi host yang dipakai VComm', () => {
    // Sengaja require() di dalam test agar kegagalan membaca berkasnya
    // muncul sebagai kegagalan test ini saja.
    const real = parseConfig(require('../config/server-config.json'));
    expect(real.dnsMap['chat.id']).toBe(2);
    expect(real.dnsMap['blm.id']).toBe(-1);
    expect(real.fallbackApiUrls.length).toBeGreaterThan(0);
    expect(fallbackHostname(real)).toBe('blm.id');
  });
});
