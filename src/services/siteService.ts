

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

/**
 * Fetch custom sites from the remote API
 * @param appKey The application key to fetch sites for (default: 'chat')
 */
export const fetchCustomSites = async (appKey: string = 'chat'): Promise<Site[]> => {
  try {
    const url = `${BASE_SITES_API_URL}/${appKey}`;
    console.log(`[Sites] Fetching ${appKey} sites from:`, url);

    // Simple fetch without custom headers
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch sites: ${response.status}`);
    }

    const data = await response.json();
    console.log('[Sites] Received data:', JSON.stringify(data));

    // More robust data normalization
    let rawItems: any[] = [];

    if (Array.isArray(data)) {
      rawItems = data;
    } else if (data && typeof data === 'object') {
      // Check for nested 'sites' in 'data' object (common pattern: { status: 'success', data: { sites: [...] } })
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
        // If data.data is an object but doesn't have .sites, it might be the items themselves as a map
        rawItems = Object.entries(data.data).map(([key, value]) => ({
          key,
          ...(typeof value === 'object' ? value : { value }),
        }));
      } else {
        // Last resort: check if data itself is a map (excluding status fields)
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
      // Try to find a label/name
      const label = item.siteName || item.label || item.name || item.Site || item.site || item.site_name || item.key || 'Site';

      // Look for specific app IPs in the 'ips' array if it exists
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

    console.log(`[Sites] Mapped ${mappedSites.length} sites`);

    if (mappedSites.length === 0 && rawItems.length > 0) {
      console.warn('[Sites] Data found but mapping failed. First item sample:', JSON.stringify(rawItems[0]));
    }

    return mappedSites;

  } catch (error: any) {
    console.error('[Sites] Fetch error:', error);
    return [];
  }
};
