import { useEffect } from 'react';
import { prefersReducedMotion } from './motion/preferences';

/**
 * Adds a one-way scroll reveal to a curated set of landing-page blocks.
 *
 * Done from one place rather than by threading a prop through every section component: the
 * targets are stable, long-lived class names, and this way adding or removing a reveal is a
 * one-line change here instead of an edit to five files.
 *
 * One-way on purpose — elements do not re-hide when scrolled back past, which is disorienting
 * on a page people scrub up and down. Each element is unobserved once it has arrived, so the
 * observer empties itself as the page is read.
 *
 * Under prefers-reduced-motion nothing is marked at all, so the CSS never applies and the page
 * renders in its final state on first paint.
 */

const TARGETS = [
  '.workflow-heading',
  '.workflow-list > li',
  '.atlas-narrative',
  '.atlas-scene',
  '.atlas-caption',
  '.dossier-copy',
  '.dossier-stage',
  '.why-statement',
  '.why-comparison',
  '.truth-line',
  '.closing-section > *',
].join(', ');

export function useScrollReveal(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    if (prefersReducedMotion()) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const nodes = Array.from(document.querySelectorAll<HTMLElement>(TARGETS));
    if (nodes.length === 0) return;

    // Stagger only within a shared parent, so a list reads as a sequence while unrelated
    // blocks elsewhere on the page are not delayed behind it.
    const seen = new Map<Element, number>();
    nodes.forEach((node) => {
      const parent = node.parentElement ?? document.body;
      const index = seen.get(parent) ?? 0;
      seen.set(parent, index + 1);
      node.style.setProperty('--cf-reveal-delay', `${Math.min(index, 6) * 70}ms`);
      node.classList.add('cf-reveal');
    });

    function reveal(el: HTMLElement) {
      if (el.classList.contains('cf-in')) return;
      el.classList.add('cf-in');
      observer.unobserve(el);
      window.setTimeout(() => el.classList.add('cf-settled'), 1100);
    }

    // threshold 0 rather than a fraction: a fast scroll or an in-page anchor jump can move an
    // element across the viewport between two observer ticks, and at a higher threshold that
    // element is simply never reported. Any overlap at all counts.
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) reveal(entry.target as HTMLElement);
        });
      },
      { threshold: 0, rootMargin: '0px 0px -6% 0px' },
    );

    nodes.forEach((node) => observer.observe(node));

    // Safety net. The header nav jumps straight to #why and #product, which can carry a block
    // past the viewport without the observer ever seeing it intersect — and because the reveal
    // starts at opacity 0, a missed element stays invisible for the rest of the session. This
    // sweep reveals anything the scroll position has already passed, so the worst case is a
    // block that appears without animating rather than one that never appears at all.
    let sweepQueued = false;
    function sweep() {
      sweepQueued = false;
      const limit = window.innerHeight * 0.94;
      nodes.forEach((node) => {
        if (node.classList.contains('cf-in')) return;
        if (node.getBoundingClientRect().top < limit) reveal(node);
      });
    }
    function queueSweep() {
      if (sweepQueued) return;
      sweepQueued = true;
      requestAnimationFrame(sweep);
    }

    window.addEventListener('scroll', queueSweep, { passive: true });
    window.addEventListener('resize', queueSweep, { passive: true });
    queueSweep();

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', queueSweep);
      window.removeEventListener('resize', queueSweep);
      nodes.forEach((node) => node.classList.remove('cf-reveal', 'cf-in', 'cf-settled'));
    };
  }, [enabled]);
}
