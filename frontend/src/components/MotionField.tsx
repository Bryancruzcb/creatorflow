import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion, watchReducedMotion } from '../motion/preferences';

/**
 * The hero backdrop: two scalar motion fields drawn as survey isolines.
 *
 * This is not decoration standing in for the product — it is a picture of what the product
 * measures. One field is the reference clip, one is the candidate. Where the two motions agree
 * their contours sit on top of each other and read as a single line; where they diverge the
 * contours peel apart, and the gap between them IS the deviation. Nothing here is a score, and
 * nothing here claims a verdict — it is the shape of a comparison, which is exactly what the
 * hero is introducing.
 *
 * Deliberately hand-written WebGL2 with no library. vite.config.ts keeps three.js out of the
 * entry chunk on purpose ("must stay that way"), and the landing page must not be the thing that
 * breaks that. This costs a few KB and no new dependency.
 *
 * Renders on demand only: it stops when scrolled out of view, when the tab is hidden, and
 * entirely under prefers-reduced-motion, where it paints one static frame instead.
 */

const VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
out vec4 O;

uniform vec2  uRes;
uniform float uTime;
uniform float uDrift;   // 0 = clips agree, 1 = fully diverged
uniform vec2  uPointer;

float hash(vec2 p) {
  p = fract(p * vec2(233.34, 851.73));
  p += dot(p, p + 23.45);
  return fract(p.x * p.y);
}

float noise(vec2 x) {
  vec2 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.04; a *= 0.5; }
  return s;
}

/* One motion signal as a scalar field. seed separates reference from candidate. */
float field(vec2 uv, float seed, float t) {
  vec2 q = uv * 2.6;
  q.x += t * 0.045 + seed * 3.1;
  q += 0.42 * vec2(fbm(q + vec2(0.0, t * 0.07)), fbm(q + vec2(4.3, -t * 0.05)));
  return fbm(q) + uv.y * 0.34;
}

/*
 * Anti-aliased contour lines from a scalar field, at a constant PIXEL width.
 *
 * The previous version scaled the smoothstep edge by fwidth(v) directly, which has no floor: where
 * the field is nearly flat the gradient tends to zero, the edge collapses toward 1e-5, and the
 * contour becomes a sub-pixel line that flickers on and off as the field drifts under it. At the
 * other extreme, where the gradient is steep, contours pack closer than one pixel and alias into
 * moire that crawls. Both were visible as "the background flickers".
 *
 * The fix is the standard one for contour shading: convert the distance-to-contour into pixels
 * before thresholding, so line weight is decided in screen space and never by the field's local
 * slope, then fade out regions the raster genuinely cannot resolve rather than letting them alias.
 */
float isoline(float v, float spacing, float widthPx) {
  float sv = v * spacing;
  float g = fwidth(sv);                       // scaled-field change per pixel
  float f = fract(sv);
  float d = min(f, 1.0 - f);                  // distance to nearest contour, scaled units
  float dPx = d / max(g, 1e-4);               // ...in pixels
  float line = 1.0 - smoothstep(0.0, widthPx, dPx);

  /* Where consecutive contours land within about a pixel of each other there is no line left to
     draw — only interference. Fading to flat there is what removes the crawl. */
  float resolvable = 1.0 - smoothstep(0.35, 0.9, g);
  return line * resolvable;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec2 pt = uPointer * 0.12;

  float t = uTime;

  // Reference and candidate. They share a base signal and separate by uDrift, so at rest the
  // two line sets read as one and only pull apart as the comparison "runs".
  float a = field(uv + pt, 0.0, t);
  float b = field(uv + pt, 0.55 * uDrift, t + uDrift * 1.6);

  float la = isoline(a, 7.0, 1.15);
  float lb = isoline(b, 7.0, 1.15);

  // The candidate line is dashed. That mirrors the root-path plot inside the product, where the
  // candidate polyline already carries stroke-dasharray — so reference-vs-candidate is legible
  // without relying on colour alone.
  /* Smoothstep, not step. A hard edge on a value that moves under the pixel grid aliases exactly
     like the contours did, so the dashes strobed along the candidate line as it drifted. */
  float dashCoord = fract((uv.x * 0.7 + uv.y) * 34.0);
  float dashAA = fwidth(dashCoord) + 1e-4;
  float dash = smoothstep(0.40 - dashAA, 0.40 + dashAA, dashCoord);
  lb *= dash;

  vec3 amber = vec3(0.88, 0.62, 0.31);
  vec3 blue  = vec3(0.40, 0.60, 0.80);

  vec3 col = vec3(0.0);
  col += amber * la * 0.46;
  col += blue  * lb * 0.42;

  // Where the two disagree, brighten the gap — the deviation is the point of the image.
  float disagree = abs(la - lb);
  col += mix(amber, blue, 0.5) * disagree * 0.10;

  // Concentrate the chart to the right of the copy column instead of tiling the whole frame.
  float column = smoothstep(-0.72, 0.16, uv.x);
  col *= 0.18 + 0.82 * column;

  // Fade toward the frame edges so the type column stays clean.
  float r = length(uv * vec2(0.62, 1.0));
  col *= smoothstep(1.35, 0.20, r);

  // Horizon falloff — keeps it feeling like a chart, not a wallpaper.
  col *= 0.48 + 0.52 * smoothstep(-0.68, 0.38, uv.y);

  O = vec4(col, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    gl.deleteShader(s);
    return null;
  }
  return s;
}

export function MotionField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'low-power' });
    if (!gl) {
      setFailed(true);
      return;
    }

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) {
      setFailed(true);
      return;
    }

    const program = gl.createProgram();
    if (!program) {
      setFailed(true);
      return;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      setFailed(true);
      return;
    }
    gl.useProgram(program);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, 'uRes');
    const uTime = gl.getUniformLocation(program, 'uTime');
    const uDrift = gl.getUniformLocation(program, 'uDrift');
    const uPointer = gl.getUniformLocation(program, 'uPointer');

    let reduced = prefersReducedMotion();
    let visible = true;
    let pageVisible = !document.hidden;
    let frame = 0;
    const started = performance.now();

    const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
    let drift = 0;

    function size() {
      const context = gl;
      if (!context || !canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr * 0.85));
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr * 0.85));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        context.viewport(0, 0, w, h);
      }
    }

    function draw(now: number) {
      const context = gl;
      if (!context || !canvas) return;
      size();
      const t = (now - started) / 1000;

      pointer.sx += (pointer.x - pointer.sx) * 0.05;
      pointer.sy += (pointer.y - pointer.sy) * 0.05;

      // The comparison "runs": drift eases in, holds, and releases, so the two line sets
      // separate and rejoin instead of sitting at a fixed offset.
      drift = 0.5 - 0.5 * Math.cos(t * 0.24);

      context.uniform2f(uRes, canvas.width, canvas.height);
      context.uniform1f(uTime, t);
      context.uniform1f(uDrift, reduced ? 0.45 : drift);
      context.uniform2f(uPointer, pointer.sx, pointer.sy);
      context.drawArrays(context.TRIANGLES, 0, 3);
    }

    function loop(now: number) {
      frame = 0;
      if (reduced || !visible || !pageVisible) return;
      draw(now);
      schedule();
    }

    function schedule() {
      if (frame === 0 && !reduced && visible && pageVisible) {
        frame = requestAnimationFrame(loop);
      }
    }

    function onPointer(event: PointerEvent) {
      pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.y = -((event.clientY / window.innerHeight) * 2 - 1);
    }

    function onVisibility() {
      pageVisible = !document.hidden;
      if (pageVisible) schedule();
      else if (frame) { cancelAnimationFrame(frame); frame = 0; }
    }

    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible) schedule();
        else if (frame) { cancelAnimationFrame(frame); frame = 0; }
      },
      { rootMargin: '120px', threshold: 0.01 },
    );
    observer?.observe(canvas);

    const stopWatchingMotion = watchReducedMotion((next) => {
      reduced = next;
      if (reduced) {
        if (frame) { cancelAnimationFrame(frame); frame = 0; }
        draw(performance.now());
      } else {
        schedule();
      }
    });

    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);

    // Always paint one frame, so reduced-motion users get the image without the animation.
    draw(performance.now());
    schedule();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
      stopWatchingMotion?.();
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('resize', schedule);
      document.removeEventListener('visibilitychange', onVisibility);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
    };
  }, []);

  if (failed) return null;

  return <canvas ref={canvasRef} className="cf-motion-field" aria-hidden="true" />;
}
