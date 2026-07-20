import { useEffect, useState } from 'react';

/** The `beforeinstallprompt` event (not in the DOM lib types). */
interface BIPEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * A "Install app" trigger for the PWA. Chromium fires `beforeinstallprompt` when the console is
 * installable; we stash it and show a button that calls it on demand. Hidden when already installed
 * (standalone display) or when the browser hasn't offered installation (e.g. iOS Safari, which
 * installs via Share → Add to Home Screen instead).
 */
export function InstallButton({ className = 'btn act' }: { className?: string }) {
  const [prompt, setPrompt] = useState<BIPEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      // iOS Safari
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) {
      setInstalled(true);
      return;
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BIPEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed || !prompt) return null;

  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        await prompt.prompt();
        const { outcome } = await prompt.userChoice;
        if (outcome === 'accepted') setPrompt(null);
      }}
    >
      ⤓ Install app
    </button>
  );
}
