export function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export function joinUrl(base: string, path: string): string {
  return `${stripTrailingSlash(base)}/${path.replace(/^\/+/, '')}`;
}

export type QueryValue = string | number | boolean | undefined | null | Array<string | number>;

export function buildQuery(query?: Record<string, QueryValue>): string {
  if (!query) {
    return '';
  }
  const parts: string[] = [];
  for (const key of Object.keys(query)) {
    const value = query[key];
    if (value === undefined || value === null) {
      continue;
    }
    const text = Array.isArray(value) ? value.join(',') : String(value);
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(text)}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

/**
 * Turns whatever a person types into an ordered list of base URLs to try.
 *
 * - An explicit scheme is respected: "https://watch.example.com" tries only that.
 * - Local-looking addresses (IPs, localhost, .local, port 8096) try http first,
 *   because a home server usually has no certificate.
 * - Everything else tries https first.
 */
export function serverUrlCandidates(input: string): string[] {
  const text = input.trim();
  if (!text) {
    return [];
  }
  if (/^https?:\/\//i.test(text)) {
    return [stripTrailingSlash(text)];
  }
  const bare = stripTrailingSlash(text);
  const hostPort = bare.split('/')[0];
  const looksLocal =
    /^(localhost|\d{1,3}(\.\d{1,3}){3}|[^:/]+\.local)(:\d+)?$/i.test(hostPort) ||
    /:8096$/.test(hostPort);
  return looksLocal ? [`http://${bare}`, `https://${bare}`] : [`https://${bare}`, `http://${bare}`];
}
