import { resolveUrl } from '../utils/dnsMap';

export interface Site {
  label: string;
  ip: string;
  chatIp?: string;
  blmIp?: string;
  online?: boolean | null; // null = checking, true = online, false = offline
}

const BASE_SITES_API_URL = 'http://blm.id:3003/api/v1/apps';

/**
 * Check if a site is reachable by attempting to fetch its root URL.
 * Uses a short timeout so the check doesn't block the UI.
 */
export const checkSiteStatus = async (
  ip: string,
  port: number = 5000,
  timeoutMs: number = 4000
): Promise<boolean> => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`http://${ip}:${port}`, {
      method: 'HEAD',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok || res.status < 500; // any response (even 404) means the server is reachable
  } catch {
    return false;
  }
};

/**
 * Check all sites' connectivity in parallel and return a map of ip → online status.
 */
export const checkAllSitesStatus = async (
  sites: Site[],
  port: number = 5000
): Promise<Record<string, boolean>> => {
  const results: Record<string, boolean> = {};
  const checks = sites.map(async (site) => {
    results[site.ip] = await checkSiteStatus(site.ip, port);
  });
  await Promise.allSettled(checks);
  return results;
};

export const DEFAULT_SITES: Site[] = [
  {
    label: 'KEMHAN-PUSDATIN',
    ip: '172.27.100.8',
    chatIp: '172.27.100.8',
    blmIp: '172.27.100.5',
  },
  {
    label: 'KEMHAN-MM',
    ip: '172.27.100.72',
    chatIp: '172.27.100.72',
    blmIp: '172.27.100.69',
  },
  {
    label: 'BSSN-RAGUNAN',
    ip: '172.27.100.136',
    chatIp: '172.27.100.136',
    blmIp: '172.27.100.133',
  },
];

/**
 * Fetch custom sites from the remote API
 * @param appKey The application key to fetch sites for (default: 'chat')
 */
export const fetchCustomSites = async (appKey: string = 'chat'): Promise<Site[]> => {
  const tryFetch = async (targetKey: string): Promise<Site[]> => {
    try {
      const url = await resolveUrl(`${BASE_SITES_API_URL}/${targetKey}`);
      console.log(`[Sites] Fetching ${targetKey} sites from:`, url);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Failed to fetch sites: ${response.status}`);
      }

      const data = await response.json();
      console.log('[Sites] Received data:', JSON.stringify(data));

      let rawItems: any[] = [];
      if (Array.isArray(data)) {
        rawItems = data;
      } else if (data && typeof data === 'object') {
        if (data.data && Array.isArray(data.data.sites)) {
          rawItems = data.data.sites;
        } else if (Array.isArray(data.data)) {
          rawItems = data.data;
        } else if (Array.isArray(data.sites)) {
          rawItems = data.sites;
        } else if (Array.isArray(data.results)) {
          rawItems = data.results;
        } else if (Array.isArray(data.items)) {
          rawItems = data.items;
        } else if (data.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
          rawItems = Object.entries(data.data).map(([key, value]) => ({
            key,
            ...(typeof value === 'object' ? value : { value }),
          }));
        } else {
          const entries = Object.entries(data).filter(([key]) => key !== 'status' && key !== 'message');
          if (entries.length > 0) {
            rawItems = entries.map(([key, value]) => ({
              key,
              ...(typeof value === 'object' ? value : { value }),
            }));
          }
        }
      }

      const mappedSites = rawItems.map((item: any) => {
        const label = item.siteName || item.label || item.name || item.Site || item.site || item.site_name || item.key || 'Site';
        const ips = Array.isArray(item.ips) ? item.ips : [];
        const chatApp = ips.find((a: any) => a.appKey === 'chat');
        const blmApp = ips.find((a: any) => a.appKey === 'blm');
        const firstAvailableIp = ips.length > 0 ? ips[0].ip : '';

        return {
          label: String(label),
          ip: String(chatApp?.ip || item.ip || item.IP || item.host || item.Host || firstAvailableIp || ''),
          chatIp: chatApp?.ip,
          blmIp: blmApp?.ip,
        };
      }).filter((site: any) => site.ip && site.ip.length > 0);

      console.log(`[Sites] Mapped ${mappedSites.length} sites from ${targetKey}`);
      return mappedSites;
    } catch (e) {
      console.warn(`[Sites] Error fetching from ${targetKey}:`, e);
      return [];
    }
  };

  try {
    let sites = await tryFetch(appKey);
    // If specific appKey (e.g. 'chat') returns nothing, try 'eyesee' (the canonical master endpoint)
    if (sites.length === 0 && appKey !== 'eyesee') {
      console.log('[Sites] Trying eyesee fallback endpoint');
      sites = await tryFetch('eyesee');
    }

    // If still empty (e.g. offline or unreachable master server), use predefined tactical sites
    if (sites.length === 0) {
      console.log('[Sites] Using DEFAULT_SITES fallback');
      return DEFAULT_SITES;
    }

    return sites;
  } catch (error: any) {
    console.error('[Sites] Fetch error, using DEFAULT_SITES:', error);
    return DEFAULT_SITES;
  }
};
