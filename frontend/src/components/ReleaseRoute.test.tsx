// @vitest-environment jsdom
//
// The landing page's release route, rendered. The counting rules themselves are tested as
// calculations in releaseRoute.test.ts; this file checks that the page says what those rules say,
// that the decisions on it change the route, and that each of its states renders.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FailedView, ReleaseRoute } from './ReleaseRoute';
import { releaseCounts, routeStations } from '../releaseRoute';
import { initialAssets } from '../data';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function station(name: RegExp) {
  return screen.getByRole('article', { name });
}

describe('ReleaseRoute', () => {
  it('leads with the verdict and the counts from the release rules', () => {
    render(<ReleaseRoute onOpenWorkspace={() => undefined} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe("Blocked. Northwind 1.2 can't ship yet.");
    const summary = screen.getByRole('navigation', { name: 'Release route' });
    expect(summary.textContent).toContain('01ScanDone');
    expect(summary.textContent).toContain('02Evidence6 need review');
    expect(summary.textContent).toContain('03Exceptions3 blocked');
    expect(summary.textContent).toContain('04ExportLocked');
    expect(within(summary).getByRole('link', { current: 'step' }).textContent).toContain('Evidence');
  });

  it('puts You are here on the first open station and opens the first blocker', () => {
    render(<ReleaseRoute onOpenWorkspace={() => undefined} />);
    expect(within(station(/Review the evidence/)).getAllByText('You are here')).not.toHaveLength(0);
    expect(within(station(/Scan the project/)).queryByText('You are here')).toBeNull();
    const blocker = within(station(/Resolve exceptions/)).getByRole('button', { name: /ui_icon_set\.sketch/ });
    expect(blocker.getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps export locked, with its reason, while files are open', () => {
    render(<ReleaseRoute onOpenWorkspace={() => undefined} />);
    const exportButton = within(station(/Export the manifest/)).getByRole('button', { name: /Export release manifest/ });
    expect(exportButton.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(/9 files are still open/)).toBeTruthy();
  });

  it('moves the route when the sample exceptions are resolved', async () => {
    const user = userEvent.setup();
    render(<ReleaseRoute onOpenWorkspace={() => undefined} />);
    await user.click(screen.getByRole('button', { name: 'Resolve sample exceptions' }));
    const summary = screen.getByRole('navigation', { name: 'Release route' });
    expect(summary.textContent).toContain('02Evidence4 need review');
    expect(summary.textContent).toContain('03Exceptions1 blocked');
    expect(screen.getByRole('heading', { name: /Left out of this release/ })).toBeTruthy();
  });

  it('records a decision on an open file and updates the counts', async () => {
    const user = userEvent.setup();
    render(<ReleaseRoute onOpenWorkspace={() => undefined} />);
    await user.click(screen.getByRole('button', { name: 'Attach license record' }));
    const summary = screen.getByRole('navigation', { name: 'Release route' });
    expect(summary.textContent).toContain('03Exceptions2 blocked');
  });

  it('opens the animation compare from the evidence trail and the header', async () => {
    const user = userEvent.setup();
    const onOpenWorkspace = vi.fn();
    render(<ReleaseRoute onOpenWorkspace={onOpenWorkspace} />);
    const compare = screen.getAllByRole('button', { name: /Compare two Roblox animations/ });
    expect(compare.length).toBeGreaterThanOrEqual(2);
    for (const button of compare) await user.click(button);
    expect(onOpenWorkspace).toHaveBeenCalledWith('motion');
    await user.click(screen.getByRole('button', { name: 'Open workspace' }));
    expect(onOpenWorkspace).toHaveBeenLastCalledWith('overview');
  });

  it('links the downloads under the deploy base, not the site root', () => {
    render(<ReleaseRoute onOpenWorkspace={() => undefined} />);
    const schema = screen.getByRole('link', { name: 'JSON Schema' });
    expect(schema.getAttribute('href')).toBe(`${import.meta.env.BASE_URL}creatorflow-manifest-v0.1.schema.json`);
    const manifest = screen.getByRole('link', { name: 'Download generated manifest' });
    expect(manifest.getAttribute('href')).toBe(`${import.meta.env.BASE_URL}assets/creatorflow-real-assets-manifest.json`);
  });

  it('shows the empty state before a scan, with no verdict', () => {
    render(<ReleaseRoute onOpenWorkspace={() => undefined} initialPhase="idle" />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('No verdict yet.');
    expect(screen.getByRole('button', { name: 'Start local scan' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Release route' })).toBeNull();
  });

  it('shows a progress bar, not a verdict, while the scan runs', async () => {
    const user = userEvent.setup();
    render(<ReleaseRoute onOpenWorkspace={() => undefined} initialPhase="idle" />);
    await user.click(screen.getByRole('button', { name: 'Start local scan' }));
    expect(screen.getByRole('progressbar', { name: 'Simulated scan progress' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Scanning the sample…');
  });
});

describe('FailedView', () => {
  it('says the check stopped and offers to run it again', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<FailedView stations={routeStations('failed', releaseCounts(initialAssets))} onRetry={onRetry} />);
    expect(screen.getByRole('alert').textContent).toContain('The check could not finish');
    await user.click(screen.getByRole('button', { name: 'Run the check again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
