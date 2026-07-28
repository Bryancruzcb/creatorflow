import { Activity, Boxes, Fingerprint, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
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

  const panelRef = useRef<HTMLDivElement>(null);

  /**
   * Where focus goes when this closes.
   *
   * Not "whatever was focused before", because nothing was: the dialog opens from localStorage
   * during mount, so document.activeElement is <body> and there is nothing to restore. Focus goes
   * to the workspace main region instead, which is the content the dialog was covering.
   */
  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(WELCOME_KEY, '1');
    } catch {
      // A private-mode failure just means it may greet again next time; harmless.
    }
    setOpen(false);
    window.requestAnimationFrame(() => {
      document.getElementById('workspace-main')?.focus();
    });
  }, []);

  /**
   * Focus enters on open and stays until dismissal.
   *
   * aria-modal="true" tells assistive tech the rest of the page is inert. Without a trap the DOM
   * says otherwise — Tab walked straight out into the page behind, so the announcement and the
   * behaviour disagreed, which is worse than not claiming modality at all.
   */
  useEffect(() => {
    if (!open) return undefined;

    const panel = panelRef.current;
    const focusable = () => Array.from(
      panel?.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? [],
    ).filter((el) => !el.hasAttribute('disabled'));

    focusable()[0]?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dismiss();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      // Wrap at both ends, and pull focus back in if it somehow escaped.
      if (event.shiftKey && (active === first || !panel?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel?.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dismiss]);

  if (!open) return null;

  function go(view: WorkspaceView) {
    dismiss();
    onNavigate(view);
  }

  return (
    <div className="workspace-welcome-backdrop" role="dialog" aria-modal="true" aria-labelledby="workspace-welcome-title" onClick={dismiss}>
      <div className="workspace-welcome" ref={panelRef} onClick={(event) => event.stopPropagation()}>
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
