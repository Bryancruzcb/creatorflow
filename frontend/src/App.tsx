import {
  ArrowDown,
  ArrowRight,
  FileArchive,
  FileCheck2,
  Fingerprint,
  FolderLock,
  GitBranch,
  Menu,
  ScanSearch,
  SearchCheck,
  ShieldCheck,
  X,
} from 'lucide-react';
import { motion, useReducedMotion, useScroll, useSpring } from 'framer-motion';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { AssetArtwork } from './components/AssetArtwork';
import './components/DossierStage.css';
import { BrandMark } from './components/BrandMark';
import { EvidenceAtlas } from './components/EvidenceAtlas';
import { HeroWorkspace } from './components/HeroWorkspace';
import { MotionField } from './components/MotionField';
import { KineticHeading } from './components/KineticHeading';
import { useScrollReveal } from './useScrollReveal';
import './components/MotionField.css';
import './components/LandingReveal.css';
import './components/LandingTreatment.css';
import './components/WorkflowScrub.css';
import { PreflightWorkspace } from './components/PreflightWorkspace';
import { ProductWorkspace } from './components/ProductWorkspace';
import { workflowSteps } from './data';

/**
 * three is ~600 kB and is otherwise absent from the landing bundle, so the rig arrives on its own
 * chunk and only once the section is close. `ProductWorkspace` already splits its four viewers the
 * same way; a marketing page paying the renderer's download cost on first paint would be worse.
 */
const DossierStage = lazy(() => import('./components/DossierStage').then((module) => ({ default: module.DossierStage })));

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

type WorkspaceEntry = 'overview' | 'motion';

function Navigation({ onOpenSample, onOpenWorkspace }: { onOpenSample: () => void; onOpenWorkspace: (view?: WorkspaceEntry) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <header className="site-header">
      <a className="skip-link" href="#main">Skip to main content</a>
      <a href="#top" className="brand-link" aria-label="CreatorFlow home"><BrandMark /></a>
      <nav className="desktop-nav" aria-label="Primary navigation">
        <a href="#product">Product</a>
        <a href="#workflow">Workflow</a>
        <a href="#atlas">Evidence map</a>
        <a href="#why">Why it changed</a>
        <a href="#sample-preflight">Sample</a>
      </nav>
      <div className="nav-actions">
        <a className="nav-github" href="https://github.com/Bryancruzcb/creatorflow" target="_blank" rel="noreferrer"><GitBranch size={15} /> Source</a>
        <button className="button button-primary nav-primary" type="button" onClick={() => onOpenWorkspace('overview')}>Open workspace</button>
        <button className="mobile-menu-button" type="button" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
      {open && (
        <nav className="mobile-nav" aria-label="Mobile navigation">
          <a href="#product" onClick={() => setOpen(false)}>Product</a>
          <a href="#workflow" onClick={() => setOpen(false)}>Workflow</a>
          <a href="#atlas" onClick={() => setOpen(false)}>Evidence map</a>
          <a href="#why" onClick={() => setOpen(false)}>Why it changed</a>
          <button type="button" onClick={() => { setOpen(false); onOpenWorkspace('overview'); }}>Open product workspace</button>
          <button type="button" onClick={() => { setOpen(false); onOpenSample(); }}>Run a sample preflight</button>
        </nav>
      )}
    </header>
  );
}

function AtlasSection() {
  return (
    <section className="atlas-section" id="atlas" aria-labelledby="atlas-title">
      <div className="atlas-narrative">
        <p className="section-index">After the scan</p>
        <h2 id="atlas-title">A finding is not a verdict.</h2>
        <p className="atlas-lead">Three things you do next.</p>
        <ol className="atlas-actions">
          <li><SearchCheck size={18} /><span><strong>Investigate the match</strong>Compare the media and see how the score was reached.</span></li>
          <li><FileCheck2 size={18} /><span><strong>Connect permission</strong>Attach the license, receipt, credit, or ownership declaration.</span></li>
          <li><FileArchive size={18} /><span><strong>Carry the proof forward</strong>Export hashes, sources, automated findings, and human decisions.</span></li>
        </ol>
      </div>
      <div className="atlas-scene">
        <EvidenceAtlas />
        <div className="atlas-caption"><span>Interactive evidence decision map</span><p>Select a stage, then compare the resolved and missing-license paths.</p></div>
      </div>
    </section>
  );
}

function WorkflowSection() {
  const ref = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();
  // The rail is a position readout, not an ornament: it says how far through the four
  // accountable steps the reader is, and each step marks itself once the rail passes it.
  //
  // Written straight to the DOM as a custom property rather than held in React state. Two
  // reasons: driving it through state re-renders the whole section on every scroll frame, and
  // the state update also raced the scroll badly enough that the rendered fill disagreed with
  // the measured position. useScroll({ target }) was tried first and mis-measured inside the
  // shell's `overflow: clip`, snapping 0 to 1 with nothing in between.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (reduceMotion) {
      el.style.setProperty('--cf-progress', '1');
      el.querySelectorAll('li').forEach((li) => li.setAttribute('data-reached', 'true'));
      return;
    }

    let queued = false;
    function measure() {
      queued = false;
      const node = ref.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const start = window.innerHeight * 0.78;   // begins as the section rises past 78% of the fold
      const end = window.innerHeight * 0.55;     // completes as its base clears 55%
      const span = rect.height + start - end;
      const progress = span <= 0 ? 1 : Math.min(1, Math.max(0, (start - rect.top) / span));

      node.style.setProperty('--cf-progress', progress.toFixed(4));
      const items = node.querySelectorAll('li');
      const reached = Math.ceil(progress * items.length);
      items.forEach((li, index) => li.setAttribute('data-reached', index < reached ? 'true' : 'false'));
    }
    function queue() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(measure);
    }

    measure();
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue, { passive: true });
    return () => {
      window.removeEventListener('scroll', queue);
      window.removeEventListener('resize', queue);
    };
  }, [reduceMotion]);

  return (
    <section className="workflow-section" id="workflow" ref={ref} aria-labelledby="workflow-title">
      <div className="workflow-heading">
        <p className="section-index">Four steps</p>
        <h2 id="workflow-title">How it works.</h2>
        
      </div>
      <ol className="workflow-list cf-scrubbed">
        <span className="cf-rail" aria-hidden="true">
          <i />
        </span>
        {workflowSteps.map((step, index) => (
          <li key={step.title} data-reached="false">
            <div className="workflow-number">{String(index + 1).padStart(2, '0')}</div>
            <div className="workflow-copy"><h3>{step.title}</h3><p>{step.body}</p></div>
            <div className="workflow-output"><span>Output</span><strong>{step.output}</strong></div>
            <ArrowRight size={18} aria-hidden="true" />
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Was three tilted paper sheets and a three-point bullet list.
 *
 * All of it asserted that evidence travels with an exception and none of it showed one, so a
 * reader had to take the section's own headline on faith after a wall of prose. It now runs the
 * comparison engine live against two clips on the sample rig and colours the joints the engine
 * flags — the claim and its proof are the same object. See `components/DossierStage.tsx`.
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
    <section className="dossier-section" id="product" ref={ref} aria-labelledby="dossier-title">
      <div className="dossier-copy">
        <p className="section-index">Evidence before confidence</p>
        <h2 id="dossier-title">Every exception arrives with context.</h2>
        <p>Two clips from one rig. Every joint the check flags is lit on the model — pick one.</p>
      </div>

      <Suspense fallback={<div className="evidence-rig-placeholder" aria-hidden="true" />}>
        {near ? <DossierStage /> : <div className="evidence-rig-placeholder" aria-hidden="true" />}
      </Suspense>
    </section>
  );
}

function WhySection() {
  return (
    <section className="why-section" id="why" aria-labelledby="why-title">
      <div className="why-statement">
        <p className="section-index">The product pivot</p>
        <h2 id="why-title">Same engine. Narrower job.</h2>
      </div>
      <div className="why-comparison">
        <article>
          <span>Before</span>
          <h3>A gallery with originality checks</h3>
          <p>Good technology buried in a discovery platform.</p>
        </article>
        <ArrowDown className="comparison-arrow" aria-hidden="true" />
        <article className="comparison-current">
          <span>Now</span>
          <h3>A release gate for creative teams</h3>
          <p>One job, from scan to manifest.</p>
        </article>
      </div>
      <div className="truth-line"><ShieldCheck size={18} /><p><strong>Detection proves conflicts, never originality.</strong> A clear result means no conflict was found in the registries we checked. Ownership still comes from licenses, declarations, and provenance.</p></div>
    </section>
  );
}

function LandingApp({ onOpenWorkspace }: { onOpenWorkspace: (view?: WorkspaceEntry) => void }) {
  const [startSignal, setStartSignal] = useState(0);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const scrollProgress = useSpring(scrollYProgress, { stiffness: 100, damping: 25, restDelta: 0.001 });

  useScrollReveal(!reduceMotion);

  function openSample() {
    setStartSignal((value) => value + 1);
    window.setTimeout(() => scrollTo('sample-preflight'), 30);
  }

  return (
    <div id="top" className="site-shell">
      {!reduceMotion && <motion.div className="scroll-progress" style={{ scaleX: scrollProgress }} />}
      <Navigation onOpenSample={openSample} onOpenWorkspace={onOpenWorkspace} />
      <main id="main">
        <section className="hero-section" aria-labelledby="hero-title">
          <MotionField />
          <div className="hero-copy">
            <motion.p className="hero-kicker" initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.45 }}>Preflight for Roblox projects</motion.p>
            <h1 id="hero-title">
              {reduceMotion ? <>Know what<br />can ship.</> : <KineticHeading lines={['Know what', 'can ship.']} />}
            </h1>
            <motion.p className="hero-lead" initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 0.12 }}>Scan your project, trace matches back to their source, and export a record of what you checked.</motion.p>
            <motion.div className="hero-actions" initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: 0.22 }}>
              <button className="button button-primary" type="button" onClick={() => onOpenWorkspace('motion')}><Fingerprint size={16} /> Compare two Roblox animations</button>
              <button className="button button-secondary" type="button" onClick={() => onOpenWorkspace('overview')}>Explore the release workspace <ArrowRight size={15} /></button>
            </motion.div>
            <div className="hero-roblox-path" aria-label="Roblox animation comparison flow">
              <span>Two animation IDs</span><i aria-hidden="true" /><span>Studio reads permitted keyframes</span><i aria-hidden="true" /><span>CreatorFlow saves the fingerprint</span>
            </div>
            <div className="hero-assurances">
              <span><FolderLock size={15} /> Files stay local</span>
              <span><Fingerprint size={15} /> Evidence, not scores</span>
              <span><FileArchive size={15} /> Manifest on export</span>
            </div>
          </div>
          <HeroWorkspace />
        </section>

        <WorkflowSection />
        <AtlasSection />
        <DossierSection />
        <WhySection />
        <PreflightWorkspace startSignal={startSignal} />

        <section className="closing-section">
          <BrandMark compact />
          <h2>Release with a record—not a hunch.</h2>
          <p>Sample data, nothing uploaded, a real manifest at the end.</p>
          <button className="button button-primary" type="button" onClick={openSample}>Open the sample preflight <ArrowRight size={16} /></button>
        </section>
      </main>
      <footer className="site-footer">
        <BrandMark />
        <span>Detection proves conflicts, never originality.</span>
        <a href="https://github.com/Bryancruzcb/creatorflow" target="_blank" rel="noreferrer">View the Java engine on GitHub <ArrowRight size={14} /></a>
      </footer>
      {/* Landing route only — grain never goes over the evidence ledger. */}
      <div className="cf-treatment" aria-hidden="true">
        <div className="cf-vignette" />
        <div className="cf-grain" />
      </div>
    </div>
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
