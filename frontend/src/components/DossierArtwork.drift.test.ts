import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The dossier panel and the Remotion video both hard-code data that belongs to something else:
 * rotation curves that live in a GLB, and a palette that lives in the stylesheet's oklch tokens.
 *
 * Copies drift silently. That matters more here than in most projects — this tool exists to stop
 * people shipping assets whose provenance they cannot show, and a landing page or a promotional
 * video displaying a measurement the product no longer produces is exactly that failure, committed
 * by the thing selling the fix.
 *
 * These assert both copies against the ORIGINAL rather than against each other. Two copies can
 * agree perfectly and both be stale.
 */

const FRONTEND = resolve(__dirname, '../..');
const VIDEO = resolve(FRONTEND, '../video');

function read(path: string) {
  return readFileSync(path, 'utf8');
}

/** Pull a `const NAME = [...]` numeric array out of a source file. */
function numericArray(source: string, name: string): number[] {
  const match = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(source);
  if (!match) throw new Error(`${name} not found`);
  return match[1].split(',').map((v) => Number(v.trim()));
}

/**
 * Angular distance of a bone from the clip's own first keyframe, in degrees, one value per
 * authored key. This is the definition the panel's own comment gives, re-derived here from the
 * shipped asset so the comment cannot quietly stop being true.
 */
function boneCurve(glb: Buffer, clipName: string, boneName: string): number[] {
  let offset = 12;
  let json: any = null;
  let binStart = 0;
  while (offset < glb.length) {
    const len = glb.readUInt32LE(offset);
    const type = glb.readUInt32LE(offset + 4);
    if (type === 0x4e4f534a) json = JSON.parse(glb.slice(offset + 8, offset + 8 + len).toString('utf8'));
    if (type === 0x004e4942) binStart = offset + 8;
    offset += 8 + len;
  }
  const anim = json.animations.find((a: any) => a.name === clipName);
  if (!anim) throw new Error(`clip ${clipName} not in the GLB`);

  for (const channel of anim.channels) {
    if (channel.target.path !== 'rotation') continue;
    if (json.nodes[channel.target.node].name !== boneName) continue;
    const accessor = json.accessors[anim.samplers[channel.sampler].output];
    const view = json.bufferViews[accessor.bufferView];
    const start = binStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const q0 = [0, 1, 2, 3].map((i) => glb.readFloatLE(start + i * 4));
    const out: number[] = [];
    for (let i = 0; i < accessor.count; i += 1) {
      const q = [0, 1, 2, 3].map((k) => glb.readFloatLE(start + (i * 4 + k) * 4));
      const dot = Math.abs(q0[0] * q[0] + q0[1] * q[1] + q0[2] * q[2] + q0[3] * q[3]);
      out.push(Number((2 * Math.acos(Math.min(1, dot)) * (180 / Math.PI)).toFixed(1)));
    }
    return out;
  }
  throw new Error(`no rotation channel for ${boneName} in ${clipName}`);
}

describe('landing curves match the shipped rig', () => {
  const glb = readFileSync(resolve(FRONTEND, 'public/assets/robot-expressive.glb'));
  const panel = read(resolve(FRONTEND, 'src/components/DossierArtwork.tsx'));

  it.each([
    ['WALKING', 'Walking'],
    ['WALKJUMP', 'WalkJump'],
  ])('%s is the real Foot.L curve, not a drawing', (constName, clipName) => {
    // Derived from public/assets/robot-expressive.glb on every run. If someone replaces the rig,
    // or edits the array to make the picture prettier, this fails.
    expect(numericArray(panel, constName)).toEqual(boneCurve(glb, clipName, 'Foot.L'));
  });
});

describe('the video does not drift from the product', () => {
  const panel = read(resolve(FRONTEND, 'src/components/DossierArtwork.tsx'));
  const scene = read(resolve(VIDEO, 'src/scenes/Finding.tsx'));

  it.each(['WALKING', 'WALKJUMP'])('%s is identical in both', (constName) => {
    expect(numericArray(scene, constName)).toEqual(numericArray(panel, constName));
  });

  /**
   * The video's palette is the app's oklch tokens converted to hex, because Remotion has no
   * access to the stylesheet. Re-converting here is the only way that conversion stays true.
   */
  it('the palette is the app palette', () => {
    const base = read(resolve(FRONTEND, 'src/styles/01-base.css'));
    const theme = read(resolve(VIDEO, 'src/theme.ts'));

    const toHex = (L: number, C: number, H: number) => {
      const h = (H * Math.PI) / 180;
      const a = C * Math.cos(h);
      const b = C * Math.sin(h);
      const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
      const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
      const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
      const lin = [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
      ];
      return `#${lin
        .map((x) => {
          const c = Math.max(0, Math.min(1, x));
          const srgb = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
          return Math.round(srgb * 255).toString(16).padStart(2, '0');
        })
        .join('')}`;
    };

    // token name in :root -> key in the video's theme
    const pairs: Array<[string, string]> = [
      ['desk', 'desk'], ['graphite', 'graphite'], ['raised', 'raised'],
      ['hairline', 'hairline'], ['hairline-strong', 'hairlineStrong'],
      ['ink', 'ink'], ['ink-muted', 'inkMuted'], ['ink-dim', 'inkDim'],
      ['blue-solid', 'blueSolid'], ['blue-accent', 'blueAccent'],
      ['clear', 'clear'], ['review', 'review'], ['blocked', 'blocked'],
    ];

    const drifted: string[] = [];
    for (const [token, key] of pairs) {
      const m = new RegExp(`--${token}:\\s*oklch\\(([\\d.]+)%\\s+([\\d.]+)\\s+([\\d.]+)\\)`).exec(base);
      expect(m, `--${token} is no longer an oklch triple in 01-base.css`).toBeTruthy();
      const expected = toHex(Number(m![1]) / 100, Number(m![2]), Number(m![3]));
      const actual = new RegExp(`${key}:\\s*'(#[0-9a-f]{6})'`).exec(theme);
      expect(actual, `${key} missing from video/src/theme.ts`).toBeTruthy();
      if (actual![1] !== expected) drifted.push(`${key}: video has ${actual![1]}, --${token} is ${expected}`);
    }

    expect(drifted, `video/src/theme.ts has drifted from the app palette:\n  ${drifted.join('\n  ')}`).toEqual([]);
  });
});
