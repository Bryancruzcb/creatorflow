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
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { AssetArtwork } from './components/AssetArtwork';
import { BrandMark } from './components/BrandMark';
import { EvidenceAtlas } from './components/EvidenceAtlas';
import { HeroWorkspace } from './components/HeroWorkspace';
import { PreflightWorkspace } from './components/PreflightWorkspace';
import { ProductWorkspace } from './components/ProductWorkspace';
import { StatusMark } from './components/StatusMark';
import { workflowSteps } from './data';

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
        <p className="section-index">The complete product loop</p>
        <h2 id="atlas-title">Scanning is the first ten seconds. The product is everything after.</h2>
        <p className="atlas-lead">CreatorFlow turns a machine finding into a traceable release decision. The expensive part of the product is not drawing a warning—it is showing the evidence clearly enough that a real team can act on it.</p>
        <ol className="atlas-actions">
          <li><SearchCheck size={18} /><span><strong>Investigate the match</strong>Open every source record, compare the media, and see how the detector reached the finding.</span></li>
          <li><FileCheck2 size={18} /><span><strong>Connect permission</strong>Attach the license, receipt, credit, ownership declaration, or exclusion that resolves the release risk.</span></li>
          <li><FileArchive size={18} /><span><strong>Carry the proof forward</strong>Export hashes, sources, automated findings, and human decisions with the release.</span></li>
        </ol>
      </div>
      <div className="atlas-scene">
        <EvidenceAtlas />
        <div className="atlas-caption"><span>Interactive evidence decision map</span><p>Select a stage to inspect its responsibility, then compare the resolved path with the missing-license branch.</p></div>
      </div>
    </section>
  );
}

function WorkflowSection() {
  return (
    <section className="workflow-section" id="workflow" aria-labelledby="workflow-title">
      <div className="workflow-heading">
        <p className="section-index">One decision, four accountable steps</p>
        <h2 id="workflow-title">A workflow built around shipping—not collecting.</h2>
        <p>The gallery made originality checks feel like a feature. Preflight makes the evidence part of a decision your team already has to make.</p>
      </div>
      <ol className="workflow-list">
        {workflowSteps.map((step, index) => (
          <li key={step.title}>
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

function DossierSection() {
  const ref = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const leftY = useTransform(scrollYProgress, [0, 1], reduceMotion ? [0, 0] : [70, -50]);
  const rightY = useTransform(scrollYProgress, [0, 1], reduceMotion ? [0, 0] : [25, -85]);

  return (
    <section className="dossier-section" id="product" ref={ref} aria-labelledby="dossier-title">
      <div className="dossier-copy">
        <p className="section-index">Evidence before confidence</p>
        <h2 id="dossier-title">Every exception arrives with context.</h2>
        <p>A fingerprint finding is only useful when the team can trace it back to a file, a source, a license, and a human decision. CreatorFlow keeps those pieces together.</p>
        <ul className="dossier-points">
          <li><Fingerprint size={17} /><span><strong>Deterministic checks</strong>Exact hashes, perceptual image signatures, audio fingerprints, and metadata.</span></li>
          <li><FolderLock size={17} /><span><strong>Local by default</strong>Your files stay on the machine; connected registries receive fingerprints only.</span></li>
          <li><FileArchive size={17} /><span><strong>Portable release record</strong>Export the evidence and every human exception as a shareable manifest.</span></li>
        </ul>
      </div>

      <div className="dossier-stage" aria-label="Layered evidence dossier">
        <motion.div className="dossier-sheet dossier-sprite" style={{ y: leftY }}><span>Asset / sprite sheet</span><AssetArtwork kind="sprite" /></motion.div>
        <motion.div className="dossier-sheet dossier-license" style={{ y: rightY }}><span>License / source record</span><AssetArtwork kind="receipt" /></motion.div>
        <div className="dossier-sheet dossier-manifest">
          <div className="manifest-pin" aria-hidden="true" />
          <span>Release manifest</span>
          <h3>Northwind</h3>
          <dl><div><dt>Version</dt><dd>1.2.0</dd></div><div><dt>Files</dt><dd>248</dd></div><div><dt>Blocked</dt><dd>2</dd></div></dl>
          <div className="manifest-rule" />
          <StatusMark value="review" />
        </div>
        <div className="dossier-sheet dossier-hash"><span>SHA-256</span><code>5D7A386E6F5C4D8B<br />9A1E7F0C8D2B3A6F</code></div>
      </div>
    </section>
  );
}

function WhySection() {
  return (
    <section className="why-section" id="why" aria-labelledby="why-title">
      <div className="why-statement">
        <p className="section-index">The product pivot</p>
        <h2 id="why-title">The engine was strong. The framing was too broad.</h2>
      </div>
      <div className="why-comparison">
        <article>
          <span>Before</span>
          <h3>A gallery with originality checks</h3>
          <p>Interesting technology attached to a crowded discovery platform. The user could browse and upload, but the most valuable moment was buried inside publishing.</p>
        </article>
        <ArrowDown className="comparison-arrow" aria-hidden="true" />
        <article className="comparison-current">
          <span>Now</span>
          <h3>A release gate for creative teams</h3>
          <p>One urgent job, one complete loop: scan the project, understand the risks, record the decision, and produce the evidence that can ship with the work.</p>
        </article>
      </div>
      <div className="truth-line"><ShieldCheck size={18} /><p><strong>Detection proves conflicts, never originality.</strong> A clear result means no conflict was found in the checked registries. Ownership still comes from declarations, licenses, provenance, and a dispute process.</p></div>
    </section>
  );
}

function LandingApp({ onOpenWorkspace }: { onOpenWorkspace: (view?: WorkspaceEntry) => void }) {
  const [startSignal, setStartSignal] = useState(0);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const scrollProgress = useSpring(scrollYProgress, { stiffness: 100, damping: 25, restDelta: 0.001 });

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
          <div className="hero-copy">
            <motion.p className="hero-kicker" initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.45 }}>Local-first release preflight</motion.p>
            <motion.h1 id="hero-title" initial={reduceMotion ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}>Know what<br />can ship.</motion.h1>
            <motion.p className="hero-lead" initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 0.12 }}>CreatorFlow scans a game or creative project, traces suspicious assets back to real source records, guides human resolution, and exports the evidence behind the release.</motion.p>
            <motion.div className="hero-actions" initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: 0.22 }}>
              <button className="button button-primary" type="button" onClick={() => onOpenWorkspace('motion')}><Fingerprint size={16} /> Compare two Roblox animations</button>
              <button className="button button-secondary" type="button" onClick={() => onOpenWorkspace('overview')}>Explore the release workspace <ArrowRight size={15} /></button>
            </motion.div>
            <div className="hero-roblox-path" aria-label="Roblox animation comparison flow">
              <span>Two animation IDs</span><i aria-hidden="true" /><span>Studio reads permitted keyframes locally</span><i aria-hidden="true" /><span>CreatorFlow saves the fingerprint evidence</span>
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
          <p>CreatorFlow turns the fingerprint engine you already built into a workflow a team can understand, trust, and demonstrate.</p>
          <button className="button button-primary" type="button" onClick={openSample}>Open the sample preflight <ArrowRight size={16} /></button>
        </section>
      </main>
      <footer className="site-footer">
        <BrandMark />
        <span>Detection proves conflicts, never originality.</span>
        <a href="https://github.com/Bryancruzcb/creatorflow" target="_blank" rel="noreferrer">View the Java engine on GitHub <ArrowRight size={14} /></a>
      </footer>
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

  function openWorkspace(view: WorkspaceEntry = 'overview') {
    window.location.hash = `workspace?view=${view}`;
    setWorkspaceOpen(true);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function closeWorkspace() {
    window.location.hash = 'top';
    setWorkspaceOpen(false);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  return workspaceOpen ? <ProductWorkspace onExit={closeWorkspace} /> : <LandingApp onOpenWorkspace={openWorkspace} />;
}

export default App;
