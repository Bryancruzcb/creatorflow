import { initialAssets, workflowSteps } from './data';
import { buildReleaseManifest } from './manifest/releaseManifest';
import type { CreatorFlowManifest } from './manifest/manifest';

/**
 * The four workflow steps, told through one file's record instead of described.
 *
 * The section used to be four rows of prose, each ending in a label like "Output: JSON release
 * record" — naming an artefact it never showed. 879px of page for 79 words, and nothing on it a
 * visitor could look at.
 *
 * So the panel beside the steps is a real manifest entry, and each step reveals the fields that
 * step is what produces. Nothing here is transcribed: the values are read out of the object
 * `buildReleaseManifest` returns, the same function the sample workspace's export button calls
 * with the same project name and release. If the manifest format changes, this section changes
 * with it — which is the point. A page that hardcodes a copy of its own output starts lying the
 * first time the output moves.
 */

/** The sample project, matching `PreflightWorkspace.exportManifest`. */
export const SAMPLE_PROJECT = 'Northwind';
export const SAMPLE_RELEASE = '1.2.0';

/**
 * Fixed, not `new Date()`.
 *
 * A timestamp that moves on every render makes this section's output differ from itself between
 * two reads of the same page, and would make any snapshot of it flake. The manifest this mirrors
 * is a sample; its generation time is not one of the facts on offer.
 */
export const SAMPLE_GENERATED_AT = '2026-07-28T00:00:00.000Z';

const SAMPLE_ASSET_ID = 'avocado-prop';

export interface RecordField {
  label: string;
  value: string;
  /** Long values (hashes, paths, URLs) get their own line rather than a label/value row. */
  block?: boolean;
}

export interface WorkflowStage {
  title: string;
  body: string;
  /** What this step contributes to the record, phrased as the manifest keys it fills in. */
  produces: string;
  fields: RecordField[];
}

export interface WorkflowRecord {
  fileName: string;
  /** Headline for the review step. Real similarity from the asset's own match record. */
  topMatch: { title: string; provider: string; similarity: number } | null;
  stages: WorkflowStage[];
  manifest: CreatorFlowManifest;
  json: string;
}

/**
 * Byte counts read better grouped, but the manifest's own value is what is shown.
 *
 * Deliberately not converted to "7.7 MB": the field is `sizeBytes` and the number is the number.
 * Rewriting it into a friendlier unit would mean the panel no longer matches the file it claims
 * to be showing.
 */
function groupDigits(value: number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function buildWorkflowRecord(): WorkflowRecord {
  const source = initialAssets.find((asset) => asset.id === SAMPLE_ASSET_ID);
  if (!source) throw new Error(`workflow record: sample asset ${SAMPLE_ASSET_ID} is missing`);

  const manifest = buildReleaseManifest([source], {
    projectName: SAMPLE_PROJECT,
    release: SAMPLE_RELEASE,
    generatedAt: SAMPLE_GENERATED_AT,
  });
  const entry = manifest.assets[0];

  /**
   * The headline percentage comes from the asset's own match record rather than the manifest.
   *
   * `ManifestMatch` carries a layer and a hamming distance, not a percentage — the 99% lives in
   * the findings prose, and parsing a number back out of a sentence would break the moment
   * someone rewords it.
   *
   * The file's own local-import record is excluded first. It scores 100% because it IS the file,
   * and taking the highest similarity without filtering produced the headline "100% similar to
   * avocado_foodstudy_v02.glb" — the section's one interesting number replaced by a tautology.
   * What the step is about is the external record it resembles.
   */
  const external = (source.matches ?? []).filter((match) => match.title !== source.name);
  const best = [...external].sort((a, b) => b.similarity - a.similarity)[0];

  /**
   * Titles and bodies stay in `workflowSteps`; only the manifest fields are added here.
   *
   * The step copy already had one home and the nav, the docs and this section all describe the
   * same four steps. Restating them would mean the section could drift from the list it is a
   * rendering of.
   */
  const produced: Array<{ produces: string; fields: RecordField[] }> = [
    {
      produces: 'identity',
      fields: [
        { label: 'path', value: entry.path, block: true },
        { label: 'fileType', value: entry.fileType },
        { label: 'sizeBytes', value: groupDigits(entry.sizeBytes) },
        { label: 'sha256', value: entry.sha256, block: true },
      ],
    },
    {
      produces: 'findings',
      fields: [
        { label: 'verification', value: entry.verification },
        { label: 'matches', value: `${entry.matches.length} · ${entry.matches[0]?.layer ?? 'none'}` },
        { label: 'findings', value: String(entry.findings.length) },
      ],
    },
    {
      produces: 'permission',
      fields: [
        { label: 'source', value: entry.source.source ?? '—' },
        { label: 'license', value: entry.source.license ?? '—', block: true },
        { label: 'decision', value: entry.decision },
      ],
    },
    {
      produces: 'release record',
      fields: [
        { label: 'project', value: `${manifest.project.name} · ${manifest.project.release}` },
        { label: 'total', value: String(manifest.summary.total) },
        { label: 'similar', value: String(manifest.summary.similar) },
        { label: 'pendingDecisions', value: String(manifest.summary.pendingDecisions) },
      ],
    },
  ];

  if (produced.length !== workflowSteps.length) {
    throw new Error(
      `workflow record: ${workflowSteps.length} steps but ${produced.length} field groups — `
      + 'a step was added to data.ts without deciding what it writes into the manifest',
    );
  }

  const stages: WorkflowStage[] = workflowSteps.map((step, index) => ({
    title: step.title,
    body: step.body,
    ...produced[index],
  }));

  return {
    fileName: entry.fileName,
    topMatch: best ? { title: best.title, provider: best.provider, similarity: best.similarity } : null,
    stages,
    manifest,
    json: JSON.stringify(manifest, null, 2),
  };
}

/** Every field revealed up to and including `stageIndex`. */
export function fieldsThrough(record: WorkflowRecord, stageIndex: number): RecordField[] {
  return record.stages.slice(0, stageIndex + 1).flatMap((stage) => stage.fields);
}
