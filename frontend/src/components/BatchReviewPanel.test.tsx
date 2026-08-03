// @vitest-environment jsdom
//
// Component test for the group-review panel. jsdom is scoped per file, as this project does it
// (LocalProjectWorkspace.decisionFlow.test.tsx:1) rather than globally.
//
// What is asserted here is mostly what is ABSENT: no Approve control, nothing pre-checked, no
// submit until a person has selected a set and written why. Those are the feature, not the polish —
// the panel's whole justification is that it cannot be used to manufacture judgement at scale.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  BatchReviewPanel,
  batchConfirmationCopy,
  narrowGroupAssets,
  parentFolder,
  reviewGroupLabel,
} from './BatchReviewPanel';
import { LocalBridgeError, type LocalBridgeClient, type LocalReviewGroupAsset } from '../bridge/localBridge';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function asset(index: number, overrides: Partial<LocalReviewGroupAsset> = {}): LocalReviewGroupAsset {
  return {
    scanAssetId: index,
    relativePath: `art/kits/rock/asset-${index}.png`,
    fileName: `asset-${index}.png`,
    fileType: 'png',
    sha256: String(index).repeat(64).slice(0, 64),
    verification: 'CLEAR',
    decision: 'PENDING',
    message: 'Source and license evidence must be resolved or the asset excluded',
    latestDecisionId: null,
    latestSourceEvidenceId: index * 10,
    alsoStandingCodes: [],
    ...overrides,
  };
}

const unresolvedGroup = {
  code: 'UNRESOLVED_SOURCE' as const,
  message: 'Source and license evidence must be resolved or the asset excluded',
  batchableActions: ['SOURCE_EVIDENCE', 'EXCLUDED', 'NEEDS_REVIEW'] as const,
  assets: [asset(1), asset(2), asset(3)],
};

const flaggedGroup = {
  code: 'FLAGGED_WITHOUT_APPROVAL' as const,
  message: 'SIMILAR and DUPLICATE assets require APPROVED or EXCLUDED',
  batchableActions: ['NEEDS_REVIEW'] as const,
  assets: [asset(4, { verification: 'SIMILAR' }), asset(5, { verification: 'SIMILAR' })],
};

const blockedGroup = {
  code: 'BLOCKED_DECISION' as const,
  message: 'A BLOCKED decision always prevents release',
  batchableActions: [] as const,
  assets: [asset(6, { decision: 'BLOCKED' }), asset(7, { decision: 'BLOCKED' })],
};

function makeClient(overrides: Record<string, ReturnType<typeof vi.fn>> = {}, groups: unknown[] = [unresolvedGroup]) {
  const client = {
    session: { csrfToken: 'csrf-token', origin: 'http://localhost:3000', openCloudKeyConfigured: true },
    listReviewGroups: vi.fn().mockResolvedValue({
      scanRunId: 'run-abc', gateResult: 'BLOCKED', evaluatedAt: '2026-08-02T21:00:00Z', groups,
    }),
    recordBatchDecision: vi.fn(),
    recordBatchSourceEvidence: vi.fn(),
    ...overrides,
  };
  return client as unknown as LocalBridgeClient;
}

async function openGroup(label: string) {
  await userEvent.click(await screen.findByRole('button', { name: new RegExp(label, 'i') }));
}

describe('BatchReviewPanel', () => {
  it('renders no Approve or Block control anywhere, and says where those decisions belong', async () => {
    render(<BatchReviewPanel client={makeClient()} scanRunId="run-abc" />);
    await openGroup('Unresolved source');

    // Absent, not disabled: a greyed-out Approve is an invitation to ask how to turn it on.
    expect(screen.queryByLabelText(/^approve/i)).toBeNull();
    expect(screen.queryByRole('radio', { name: /approve/i })).toBeNull();
    expect(screen.queryByRole('radio', { name: /block/i })).toBeNull();
    expect(screen.getByText(/per-file call — open the file and record it there/i)).toBeTruthy();
  });

  it('pre-checks nothing, and the narrowing filters never select anything either', async () => {
    render(<BatchReviewPanel client={makeClient()} scanRunId="run-abc" />);
    await openGroup('Unresolved source');

    const boxes = screen.getAllByRole('checkbox').filter((box) => box.getAttribute('name') !== 'shared');
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.every((box) => !(box as HTMLInputElement).checked)).toBe(true);

    await userEvent.selectOptions(screen.getByLabelText('File type'), 'png');
    const afterFiltering = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(afterFiltering.every((box) => !box.checked)).toBe(true);
  });

  it('will not offer to write anything until a set, an action and a written reason all exist', async () => {
    render(<BatchReviewPanel client={makeClient()} scanRunId="run-abc" />);
    await openGroup('Unresolved source');

    const submit = () => screen.getByRole('button', { name: /review what this writes/i }) as HTMLButtonElement;
    expect(submit().disabled).toBe(true);

    // One file is a per-file decision, so one selection is not enough on its own.
    await userEvent.click(screen.getByRole('checkbox', { name: /asset-1\.png/i }));
    await userEvent.click(screen.getByRole('radio', { name: 'Mark needs review' }));
    await userEvent.type(screen.getByLabelText(/why do these files belong together/i), 'Same kit.');
    expect(submit().disabled).toBe(true);

    await userEvent.click(screen.getByRole('checkbox', { name: /asset-2\.png/i }));
    expect(submit().disabled).toBe(false);

    // And a rationale of only whitespace is not a reason.
    await userEvent.clear(screen.getByLabelText(/why do these files belong together/i));
    await userEvent.type(screen.getByLabelText(/why do these files belong together/i), '   ');
    expect(submit().disabled).toBe(true);
  });

  it('states the exact writes before recording anything, and sends the drift tokens it was given', async () => {
    const recordBatchDecision = vi.fn().mockResolvedValue({
      batchId: 'b1b2c3d4-0000-0000-0000-000000000000', scanRunId: 'run-abc', kind: 'DECISION',
      code: 'UNRESOLVED_SOURCE', action: 'NEEDS_REVIEW', rationale: 'Same kit.', assetCount: 2,
      createdAt: '2026-08-02T21:05:00Z', decisions: [],
    });
    const client = makeClient({ recordBatchDecision });
    const onLedgerChanged = vi.fn();
    render(<BatchReviewPanel client={client} scanRunId="run-abc" onLedgerChanged={onLedgerChanged} />);
    await openGroup('Unresolved source');

    await userEvent.click(screen.getByRole('checkbox', { name: /asset-1\.png/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: /asset-2\.png/i }));
    await userEvent.click(screen.getByRole('radio', { name: 'Mark needs review' }));
    await userEvent.type(screen.getByLabelText(/why do these files belong together/i),
      'Flagged in the 2.4 re-scan; scheduling a review with Marco.');
    await userEvent.click(screen.getByRole('button', { name: /review what this writes/i }));

    // The confirm step counts rows, not files "handled", and says needs-review clears nothing.
    expect(screen.getByText(/writes 1 batch record and 2 decision rows/i)).toBeTruthy();
    expect(screen.getByText(/clears nothing at the gate/i)).toBeTruthy();
    expect(recordBatchDecision).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /record this batch/i }));
    await waitFor(() => expect(recordBatchDecision).toHaveBeenCalledWith('run-abc', {
      code: 'UNRESOLVED_SOURCE',
      type: 'NEEDS_REVIEW',
      rationale: 'Flagged in the 2.4 re-scan; scheduling a review with Marco.',
      assets: [
        { scanAssetId: 1, supersedesDecisionId: null },
        { scanAssetId: 2, supersedesDecisionId: null },
      ],
    }));
    // The receipt reports rows written; the groups are re-read from the gate rather than patched.
    expect(await screen.findByText(/recorded 2 decisions as batch b1b2c3d4/i)).toBeTruthy();
    expect(client.listReviewGroups).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(onLedgerChanged).toHaveBeenCalled());
  });

  /**
   * The panel's half of the guarantee the bridge enforces: a file standing under two rules cannot be
   * batch-excluded, because at the gate an exclusion skips every check on that asset. The refusal is
   * server-side regardless; this is about never letting a person compose a batch that silently means
   * more than it says.
   */
  it('withholds batch exclusion from a file standing under another rule, with the reason on the row', async () => {
    const alsoFlagged = {
      ...unresolvedGroup,
      assets: [
        asset(1),
        asset(2, { verification: 'SIMILAR', alsoStandingCodes: ['FLAGGED_WITHOUT_APPROVAL'] }),
        asset(3),
      ],
    };
    render(<BatchReviewPanel client={makeClient({}, [alsoFlagged])} scanRunId="run-abc" />);
    await openGroup('Unresolved source');

    // The fact is on the row before any action is chosen — it is true either way.
    expect(screen.getByText(/also stands under flagged, needs a call/i)).toBeTruthy();

    // Selected under needs review, which clears nothing at the gate and so silences nothing…
    await userEvent.click(screen.getByRole('radio', { name: 'Mark needs review' }));
    await userEvent.click(screen.getByRole('checkbox', { name: /asset-2\.png/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: /asset-1\.png/i }));
    expect((screen.getByRole('checkbox', { name: /asset-2\.png/i }) as HTMLInputElement).checked).toBe(true);

    // …and dropped, disabled and explained the moment the action becomes an exclusion.
    await userEvent.click(screen.getByRole('radio', { name: 'Exclude from release' }));
    const blocked = screen.getByRole('checkbox', { name: /asset-2\.png/i }) as HTMLInputElement;
    expect(blocked.disabled).toBe(true);
    expect(blocked.checked).toBe(false);
    expect(screen.getByText(/exclude this one individually, where the findings are/i)).toBeTruthy();
    expect(screen.getByText(/1 selected/)).toBeTruthy();

    // "Select all shown" does not put it back, either.
    await userEvent.click(screen.getByRole('button', { name: /select all 3 shown/i }));
    expect((screen.getByRole('checkbox', { name: /asset-2\.png/i }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/2 selected/)).toBeTruthy();
  });

  it('clears the selection when the narrowing changes, and names every file in the confirm step', async () => {
    const twoFolders = {
      ...unresolvedGroup,
      assets: [
        asset(1, { relativePath: 'art/a/one.png', fileName: 'one.png' }),
        asset(2, { relativePath: 'art/a/two.png', fileName: 'two.png' }),
        asset(3, { relativePath: 'art/b/three.png', fileName: 'three.png' }),
        asset(4, { relativePath: 'art/b/four.png', fileName: 'four.png' }),
      ],
    };
    render(<BatchReviewPanel client={makeClient({}, [twoFolders])} scanRunId="run-abc" />);
    await openGroup('Unresolved source');

    await userEvent.selectOptions(screen.getByLabelText('Folder'), 'art/a/');
    await userEvent.click(screen.getByRole('button', { name: /select all 2 shown/i }));
    expect(screen.getByText(/2 selected/)).toBeTruthy();

    // Switching folders must not leave the first folder's two files invisibly in the batch.
    await userEvent.selectOptions(screen.getByLabelText('Folder'), 'art/b/');
    expect(screen.getByText(/0 selected/)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /select all 2 shown/i }));
    await userEvent.click(screen.getByRole('radio', { name: 'Mark needs review' }));
    await userEvent.type(screen.getByLabelText(/why do these files belong together/i), 'Same kit.');
    await userEvent.click(screen.getByRole('button', { name: /review what this writes/i }));

    // The confirm step names the files, so "confirm what you are about to write" means the paths.
    expect(screen.getByText(/writes 1 batch record and 2 decision rows/i)).toBeTruthy();
    const listed = document.querySelector('.local-batch-confirm-files')!.textContent!;
    expect(listed).toContain('art/b/three.png');
    expect(listed).toContain('art/b/four.png');
    expect(listed).not.toContain('art/a/one.png');
  });

  it('offers exclusion only where the gate says a source record is missing', async () => {
    render(<BatchReviewPanel client={makeClient({}, [unresolvedGroup, flaggedGroup])} scanRunId="run-abc" />);

    await openGroup('Unresolved source');
    expect(screen.getByRole('radio', { name: 'Exclude from release' })).toBeTruthy();

    await openGroup('Flagged, needs a call');
    expect(screen.queryByRole('radio', { name: 'Exclude from release' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Mark needs review' })).toBeTruthy();
  });

  it('shows a blocked group with no way to act on it, and says why', async () => {
    render(<BatchReviewPanel client={makeClient({}, [blockedGroup])} scanRunId="run-abc" />);
    await openGroup('Blocked');

    expect(screen.getByText(/nothing here can be batched/i)).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
    expect((screen.getAllByRole('checkbox') as HTMLInputElement[])
      .filter((box) => box.disabled === false && box.type === 'checkbox')
      .every((box) => !box.checked)).toBe(true);
  });

  it('reports a rejected batch as nothing written, and names the files that moved', async () => {
    const recordBatchDecision = vi.fn().mockRejectedValue(new LocalBridgeError(
      'The decision on one of these files changed since this group was loaded, so nothing was recorded.',
      409, null, [2],
    ));
    render(<BatchReviewPanel client={makeClient({ recordBatchDecision })} scanRunId="run-abc" />);
    await openGroup('Unresolved source');

    await userEvent.click(screen.getByRole('checkbox', { name: /asset-1\.png/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: /asset-2\.png/i }));
    await userEvent.click(screen.getByRole('radio', { name: 'Mark needs review' }));
    await userEvent.type(screen.getByLabelText(/why do these files belong together/i), 'Same kit.');
    await userEvent.click(screen.getByRole('button', { name: /review what this writes/i }));
    await userEvent.click(screen.getByRole('button', { name: /record this batch/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/nothing was recorded/i);
    expect(screen.getByText(/one file changed while this group was open/i)).toBeTruthy();
    // No receipt: nothing was written, so nothing is reported as written.
    expect(screen.queryByText(/^recorded /i)).toBeNull();
  });

  it('renders one honest line and no controls when the run cannot be evaluated', async () => {
    const listReviewGroups = vi.fn().mockRejectedValue(new LocalBridgeError(
      'Only a completed immutable scan can become a release', 409,
    ));
    render(<BatchReviewPanel client={makeClient({ listReviewGroups })} scanRunId="run-abc" />);

    expect(await screen.findByText(/only a completed immutable scan/i)).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  /**
   * The other branch of the load failure: not "there is nothing to review here" (409, which is a
   * state with no controls) but a read that failed. It has to say the read failed rather than
   * rendering an empty panel that reads as "nothing is standing".
   */
  it('reports a failed read as a failure, not as an empty gate', async () => {
    const listReviewGroups = vi.fn().mockRejectedValue(new LocalBridgeError('Local bridge request failed (500)', 500));
    render(<BatchReviewPanel client={makeClient({ listReviewGroups })} scanRunId="run-abc" />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/local bridge request failed \(500\)/i);
    expect(screen.queryByText('No outstanding group work on this scan.')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('says so plainly when the gate found no group work', async () => {
    render(<BatchReviewPanel client={makeClient({}, [])} scanRunId="run-abc" />);
    expect(await screen.findByText('No outstanding group work on this scan.')).toBeTruthy();
  });

  it('renders nothing at all without a scan run', () => {
    const { container } = render(<BatchReviewPanel client={makeClient()} scanRunId={null} />);
    expect(container.textContent).toBe('');
  });
});

describe('BatchReviewPanel pure helpers', () => {
  it('narrows from computed facts only, and returns files rather than a selection', () => {
    const assets = [
      asset(1, { relativePath: 'art/kits/rock/a.png', sha256: 'a'.repeat(64) }),
      asset(2, { relativePath: 'art/wip/b.png', fileType: 'png', sha256: 'a'.repeat(64) }),
      asset(3, { relativePath: 'art/kits/rock/c.wav', fileType: 'wav', sha256: 'c'.repeat(64) }),
    ];
    expect(narrowGroupAssets(assets, { folder: 'art/kits/rock/', fileType: '', sharedHashOnly: false })
      .map((found) => found.scanAssetId)).toEqual([1, 3]);
    expect(narrowGroupAssets(assets, { folder: '', fileType: 'wav', sharedHashOnly: false })
      .map((found) => found.scanAssetId)).toEqual([3]);
    // "Identical SHA-256" means identical to another file in the same group — a computed fact.
    expect(narrowGroupAssets(assets, { folder: '', fileType: '', sharedHashOnly: true })
      .map((found) => found.scanAssetId)).toEqual([1, 2]);
  });

  it('computes a parent folder without inventing one for a root-level file', () => {
    expect(parentFolder('art/kits/rock/a.png')).toBe('art/kits/rock/');
    expect(parentFolder('a.png')).toBe('');
  });

  it('labels the gate rules in plain words, and passes an unknown rule through untouched', () => {
    expect(reviewGroupLabel('UNRESOLVED_SOURCE')).toBe('Unresolved source');
    expect(reviewGroupLabel('A_RULE_THIS_BUILD_HAS_NEVER_HEARD_OF')).toBe('A_RULE_THIS_BUILD_HAS_NEVER_HEARD_OF');
  });

  it('promises rows, and describes what an exclusion actually does at the gate', () => {
    const excluded = batchConfirmationCopy('EXCLUDED', 12).join(' ');
    expect(excluded).toContain('12 decision rows');
    // The claim that took a review to get right: an exclusion skips EVERY check on the asset, so
    // the copy must not promise that a flag survives it. It explains the scope instead.
    expect(excluded).toContain('skips every other check on that file');
    expect(excluded).toContain('standing under this rule alone');
    expect(excluded).not.toMatch(/does not clear the similarity finding/i);
    expect(excluded).not.toMatch(/resolved/i);

    const declared = batchConfirmationCopy('SOURCE_EVIDENCE', 12).join(' ');
    expect(declared).toContain('12 source records');
    // A shared source is a declaration, and the copy has to say so rather than letting a batch of
    // twelve read as twelve checked facts.
    expect(declared).toContain('recorded as declared');
    expect(declared).toContain('CreatorFlow does not check it');
    expect(declared).toContain('nothing here becomes verified');
  });
});
