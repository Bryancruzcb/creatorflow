import { Activity, Boxes, Fingerprint, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { WorkspaceView } from './ProductWorkspace';

const WELCOME_KEY = 'creatorflow:welcomed';

const CARDS: Array<{ view: WorkspaceView; icon: typeof Activity; title: string; blurb: string }> = [
  {
    view: 'motion',
    icon: Activity,
    title: 'Compare two animations',
    blurb: 'Put two Roblox animations under the same light and see how similar they really are — with the joints and score laid out.',
  },
  {
    view: 'gallery',
    icon: Boxes,
    title: 'Browse the model gallery',
    blurb: 'Spin 24 real low-poly models. Every stat you see is read live from the file, not typed in.',
  },
  {
    view: 'evidence',
    icon: Fingerprint,
    title: 'See the release evidence',
    blurb: 'How an originality finding becomes a traceable decision you could actually ship behind.',
  },
];

/**
 * A one-time welcome for a first-time visitor to the workspace — the moment a newcomer is most
 * likely to feel lost. It names what CreatorFlow is, points at the three best things to try, and
 * never shows again once dismissed.
 */
export function WorkspaceWelcome({ onNavigate }: { onNavigate: (view: WorkspaceView) => void }) {
  const [open, setOpen] = useState(() => {
    try {
      return !window.localStorage.getItem(WELCOME_KEY);
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(WELCOME_KEY, '1');
    } catch {
      // A private-mode failure just means it may greet again next time; harmless.
    }
    setOpen(false);
  }

  function go(view: WorkspaceView) {
    dismiss();
    onNavigate(view);
  }

  return (
    <div className="workspace-welcome-backdrop" role="dialog" aria-modal="true" aria-labelledby="workspace-welcome-title" onClick={dismiss}>
      <div className="workspace-welcome" onClick={(event) => event.stopPropagation()}>
        <button className="workspace-welcome-close" type="button" onClick={dismiss} aria-label="Dismiss welcome"><X size={16} /></button>
        <span className="workspace-welcome-kicker">Welcome — sample project</span>
        <h2 id="workspace-welcome-title">Evidence for what you ship.</h2>
        <p>CreatorFlow checks creative assets — sprites, audio, and Roblox animations — for originality, and turns the findings into a decision you can trace. You're in a sample project called Northwind, so click around freely; nothing here touches your files.</p>
        <div className="workspace-welcome-cards">
          {CARDS.map((card) => (
            <button key={card.view} type="button" onClick={() => go(card.view)}>
              <span className="workspace-welcome-card-icon"><card.icon size={18} /></span>
              <strong>{card.title}</strong>
              <small>{card.blurb}</small>
            </button>
          ))}
        </div>
        <button className="workspace-welcome-skip" type="button" onClick={dismiss}>Explore on my own</button>
      </div>
    </div>
  );
}
