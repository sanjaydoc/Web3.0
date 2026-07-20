import { useEffect, useState } from 'react';

interface BIPEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'web3.pwaDismissedAt';
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000; // don't nag for a week after a dismiss

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}
function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
function recentlyDismissed(): boolean {
  const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
  return Date.now() - at < SNOOZE_MS;
}

/**
 * A proactive "Install this app" banner (the Nature/X pattern). On Chromium it captures the
 * `beforeinstallprompt` event and shows a top banner with an Install button that triggers the real
 * install flow. On iOS Safari — which has no such event — it shows the Share → Add to Home Screen
 * hint instead. Dismissals are remembered for a week, and it never shows once installed.
 */
export function InstallBanner() {
  const [prompt, setPrompt] = useState<BIPEvent | null>(null);
  const [show, setShow] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    if (isStandalone() || recentlyDismissed()) return;

    // iOS can't be prompted programmatically — offer the manual route after a short beat.
    if (isIOS()) {
      const t = setTimeout(() => {
        setIos(true);
        setShow(true);
      }, 1200);
      return () => clearTimeout(t);
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BIPEvent);
      setShow(true);
    };
    const onInstalled = () => setShow(false);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setShow(false);
  };

  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') setShow(false);
    else dismiss();
  }

  if (!show) return null;

  return (
    <div className="pwa-banner" role="dialog" aria-label="Install Web3.0">
      <span className="pwa-badge">W3</span>
      <div className="pwa-text">
        <b>Install Web3.0</b>
        <span>
          {ios ? 'Tap Share → “Add to Home Screen”' : 'Add the console to your home screen'}
        </span>
      </div>
      {!ios && (
        <button type="button" className="pwa-install" onClick={install}>
          Install
        </button>
      )}
      <button type="button" className="pwa-x" onClick={dismiss} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}
