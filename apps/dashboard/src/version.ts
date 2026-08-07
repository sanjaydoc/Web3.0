// Single source of truth for the app's released version + where to get a newer one. Bump APP_VERSION
// on every desktop/APK release. The installed app carries the value it shipped with, so it can detect
// when a newer release exists (see UpdateBanner) and prompt the operator to update — which keeps the
// fleet current so nodes don't fall behind the placement version gate (WEB3_MIN_HOST_VERSION).
export const APP_VERSION = '0.2.9';

/** The public release repo (owner/name). */
export const RELEASE_REPO = 'sanjaydoc/Web4.0';

/** The friendly download page — installer cards for every platform (desktop, community, Android). */
export const DOWNLOAD_URL = 'https://web4protocol.com/';

/** GitHub's releases list (CORS-open, no auth). We scan it for the newest semver tag rather than using
 *  `/releases/latest`, so a rolling non-semver tag (e.g. the `community` channel) can't shadow a real
 *  versioned release. */
export const RELEASES_API = `https://api.github.com/repos/${RELEASE_REPO}/releases?per_page=30`;

/**
 * Compare two dotted numeric versions. Returns >0 when `a` is newer, <0 when older, 0 when equal. A
 * leading `v` and any `-suffix` (e.g. `-rc1`) are tolerated; non-numeric parts read as 0 rather than
 * throwing, so a stray tag can never crash the update check.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map((p) => Number.parseInt(p, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}
