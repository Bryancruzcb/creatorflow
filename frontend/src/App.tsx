import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import './components/DossierStage.css';
import { ProductWorkspace } from './components/ProductWorkspace';
import { ReleaseRoute } from './components/ReleaseRoute';

/**
 * three is ~600 kB and is otherwise absent from the landing bundle, so the rig arrives on its own
 * chunk and only once the section is close. `ProductWorkspace` already splits its four viewers the
 * same way; a marketing page paying the renderer's download cost on first paint would be worse.
 */
const DossierStage = lazy(() => import('./components/DossierStage').then((module) => ({ default: module.DossierStage })));

type WorkspaceEntry = 'overview' | 'motion';

/**
 * The live rig, as a side trail off the release route: the comparison engine running against two
 * clips on the sample rig, with every joint it flags lit on the model.
 *
 * Kept on the landing page from the earlier "Every exception arrives with context" section. The
 * route's own stations show the release; this is the one place a visitor can try the motion check
 * without opening the workspace.
 */
function DossierSection() {
  const ref = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);

  /**
   * Hold the chunk back until the section is roughly a screen away.
   *
   * `lazy` alone would still fetch three as soon as React rendered the boundary, which on this
   * page is immediately — the section is mounted at the top of the tree even though it sits well
   * below the fold.
   */
  useEffect(() => {
    const node = ref.current;
    if (!node || near) return;
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setNear(true);
      observer.disconnect();
    }, { rootMargin: '600px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [near]);

  return (
    <section className="route-side-trail" id="product" ref={ref} aria-labelledby="dossier-title">
      <div className="route-side-trail-head">
        <h2 id="dossier-title">Every exception arrives with context.</h2>
      </div>

      <Suspense fallback={<div className="evidence-rig-placeholder" aria-hidden="true" />}>
        {near ? <DossierStage /> : <div className="evidence-rig-placeholder" aria-hidden="true" />}
      </Suspense>
    </section>
  );
}

function LandingApp({ onOpenWorkspace }: { onOpenWorkspace: (view?: WorkspaceEntry) => void }) {
  return (
    <ReleaseRoute onOpenWorkspace={onOpenWorkspace}>
      <DossierSection />
    </ReleaseRoute>
  );
}

function App() {
  const [workspaceOpen, setWorkspaceOpen] = useState(() => window.location.hash.startsWith('#workspace'));

  useEffect(() => {
    const sync = () => setWorkspaceOpen(window.location.hash.startsWith('#workspace'));
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  /**
   * Landing and workspace are a binary swap of the whole tree, which normally reads as a hard
   * cut. A View Transition cross-fades the two so the jump has continuity. Progressive
   * enhancement only: unsupported browsers and reduced-motion users get the swap unchanged.
   */
  function swapRoot(change: () => void) {
    const startViewTransition = (document as Document & {
      startViewTransition?: (callback: () => void) => unknown;
    }).startViewTransition;

    if (typeof startViewTransition !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      change();
      return;
    }
    startViewTransition.call(document, change);
  }

  function openWorkspace(view: WorkspaceEntry = 'overview') {
    swapRoot(() => {
      window.location.hash = `workspace?view=${view}`;
      setWorkspaceOpen(true);
      window.scrollTo({ top: 0, behavior: 'auto' });
    });
  }

  function closeWorkspace() {
    swapRoot(() => {
      window.location.hash = 'top';
      setWorkspaceOpen(false);
      window.scrollTo({ top: 0, behavior: 'auto' });
    });
  }

  return workspaceOpen ? <ProductWorkspace onExit={closeWorkspace} /> : <LandingApp onOpenWorkspace={openWorkspace} />;
}

export default App;
