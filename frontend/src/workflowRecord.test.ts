import { describe, expect, it } from 'vitest';
import {
  SAMPLE_GENERATED_AT,
  SAMPLE_PROJECT,
  SAMPLE_RELEASE,
  buildWorkflowRecord,
  fieldsThrough,
} from './workflowRecord';

describe('buildWorkflowRecord', () => {
  const record = buildWorkflowRecord();

  it('describes the sample file the workspace exports', () => {
    expect(record.fileName).toBe('avocado_foodstudy_v02.glb');
    expect(record.manifest.project).toEqual({ name: SAMPLE_PROJECT, release: SAMPLE_RELEASE });
  });

  it('keeps one stage per workflow step', () => {
    expect(record.stages).toHaveLength(4);
    expect(record.stages.map((stage) => stage.title)).toEqual([
      'Scan the project',
      'Review the evidence',
      'Resolve exceptions',
      'Export the manifest',
    ]);
  });

  /**
   * The claim the section makes. Every value on screen has to be readable back out of the
   * manifest, because the whole point is that the panel IS the export rather than a picture of
   * one. A transcribed constant would pass any test that only checked the string.
   */
  it('reads every scan and resolve field out of the built manifest', () => {
    const entry = record.manifest.assets[0];
    const byLabel = new Map(record.stages.flatMap((s) => s.fields).map((f) => [f.label, f.value]));
    expect(byLabel.get('path')).toBe(entry.path);
    expect(byLabel.get('fileType')).toBe(entry.fileType);
    expect(byLabel.get('sha256')).toBe(entry.sha256);
    expect(byLabel.get('verification')).toBe(entry.verification);
    expect(byLabel.get('decision')).toBe(entry.decision);
    expect(byLabel.get('source')).toBe(entry.source.source);
    expect(byLabel.get('license')).toBe(entry.source.license);
  });

  it('reports the real counts rather than a fixed label', () => {
    const entry = record.manifest.assets[0];
    const byLabel = new Map(record.stages.flatMap((s) => s.fields).map((f) => [f.label, f.value]));
    expect(byLabel.get('findings')).toBe(String(entry.findings.length));
    expect(byLabel.get('matches')).toContain(String(entry.matches.length));
    expect(byLabel.get('matches')).toContain(entry.matches[0].layer);
  });

  it('carries a real sha256, not a placeholder', () => {
    expect(record.manifest.assets[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('surfaces the strongest match for the review step', () => {
    expect(record.topMatch).not.toBeNull();
    expect(record.topMatch!.similarity).toBeGreaterThan(50);
    expect(record.topMatch!.similarity).toBeLessThanOrEqual(100);
    expect(record.topMatch!.provider).toBeTruthy();
  });

  /**
   * The file's own local-import record scores 100% because it is the file. Ranking on similarity
   * alone put it top and rendered "100% similar to avocado_foodstudy_v02.glb" on the landing page
   * — true, circular, and the one number the step exists to show.
   */
  it('never headlines the file matching itself', () => {
    expect(record.topMatch!.title).not.toBe(record.fileName);
    expect(record.topMatch!.title).toBe('Avocado.glb — upstream GLB');
    expect(record.topMatch!.provider).toBe('Khronos glTF Sample Assets');
    expect(record.topMatch!.similarity).toBe(99);
  });

  /**
   * A moving timestamp would make the section differ from itself between two reads of the same
   * page and flake any snapshot taken of it.
   */
  it('is deterministic', () => {
    expect(record.manifest.generatedAt).toBe(SAMPLE_GENERATED_AT);
    expect(buildWorkflowRecord().json).toBe(record.json);
  });

  it('emits parseable manifest JSON', () => {
    expect(() => JSON.parse(record.json)).not.toThrow();
    expect(JSON.parse(record.json)).toEqual(record.manifest);
  });
});

describe('fieldsThrough', () => {
  const record = buildWorkflowRecord();

  it('accumulates rather than replaces', () => {
    const first = fieldsThrough(record, 0);
    const last = fieldsThrough(record, record.stages.length - 1);
    expect(first).toEqual(record.stages[0].fields);
    expect(last.length).toBe(record.stages.reduce((n, stage) => n + stage.fields.length, 0));
    // Every earlier field is still present at the end, in order.
    expect(last.slice(0, first.length)).toEqual(first);
  });

  it('grows monotonically across the steps', () => {
    const counts = record.stages.map((_, index) => fieldsThrough(record, index).length);
    expect([...counts].sort((a, b) => a - b)).toEqual(counts);
    expect(new Set(counts).size).toBe(counts.length);
  });
});
