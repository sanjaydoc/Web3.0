import { useEffect, useState } from 'react';
import { APP_VERSION, DOWNLOAD_URL, RELEASES_API, compareVersions } from './version.js';

// Remember a skipped version so we stop nagging for it — but re-appear the moment a NEWER one ships.
const DISMISS_KEY = 'web3.updateDismissedVersion';
// Re-check periodically while the app stays open (in addition to the check on mount).
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * True when we're an INSTALLED node app — desktop (Electron), Android (Capacitor), or an installed PWA
 * — as opposed to the plain web console on the website. Only installed apps go stale and need updating;
 * the website always serves the latest build, so it must never show this banner.
 */
function isInstalledApp(): boolean {
  const ua = navigator.userAgent || '';
  if (/electron/i.test(ua)) return true; // desktop app
  if ((window as unknown as { Capacitor?: unknown }).Capacitor) return true; // Android APK
  return Boolean(
    window.matchMedia?.('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true,
  );
}

/**
 * Auto-update nudge for the desktop / community / Android node apps. On an installed app it checks the
 * GitHub releases list for the newest published version and, when the running build (`APP_VERSION`,
 * baked in at build time) is older, shows a top banner with an **Update** button that opens the download
 * page. Dismissals are remembered per-version, so it stops nagging for a version you skip but returns
 * the instant a newer one ships. This is the operator-facing half of the "don't run a stale node" fix:
 * it keeps honest nodes current so they stay above the placement version gate. The website never shows
 * it (it's always the latest build). Fully silent on error (offline / rate-limited) — it just retries.
 */
export function UpdateBanner() {
  const [latest, setLatest] = useState<string | null>(null);

  useEffect(() => {
    if (!isInstalledApp()) return;
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch(RELEASES_API, {
          headers: { Accept: 'application/vnd.github+json' },
        });
        if (!res.ok) return;
        const data = (await res.json()) as Array<{
          tag_name?: string;
          draft?: boolean;
          prerelease?: boolean;
        }>;
        // Newest real (semver, non-draft, non-prerelease) release tag — ignores rolling channels.
        const tags = data
          .filter((r) => !r.draft && !r.prerelease)
          .map((r) => (r.tag_name ?? '').trim())
          .filter((t) => /^v?\d+\.\d+/.test(t));
        if (!alive || tags.length === 0) return;
        const newest = tags.reduce((a, b) => (compareVersions(b, a) > 0 ? b : a));
        if (compareVersions(newest, APP_VERSION) > 0) setLatest(newest.replace(/^v/i, ''));
      } catch {
        // Offline / rate-limited — skip quietly; the interval will try again.
      }
    };
    void check();
    const t = setInterval(check, CHECK_INTERVAL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!latest) return null;
  if (localStorage.getItem(DISMISS_KEY) === latest) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, latest);
    setLatest(null);
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: transient update prompt; native <dialog> semantics/backdrop aren't wanted here
    <div className="pwa-banner update-banner" role="dialog" aria-label="Update available">
      <span className="pwa-badge update-badge">↑</span>
      <div className="pwa-text">
        <b>Update available — v{latest}</b>
        <span>Your node is out of date. Update to stay compatible with the network.</span>
      </div>
      <a className="pwa-install" href={DOWNLOAD_URL} target="_blank" rel="noreferrer">
        Update
      </a>
      <button type="button" className="pwa-x" onClick={dismiss} aria-label="Dismiss update banner">
        ✕
      </button>
    </div>
  );
}
