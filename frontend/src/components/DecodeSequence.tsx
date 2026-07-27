import './DecodeSequence.css';

/**
 * The loading state for the lazily-mounted 3D surfaces.
 *
 * Deliberately INDETERMINATE. A percentage here would have to be invented — the chunk fetch and
 * the GLTF parse do not report progress through this boundary — and a fabricated progress number
 * is precisely the pattern being removed from the sample preflight. So this shows that work is
 * happening and names what is being decoded, without claiming to know how far along it is.
 *
 * `label` should name the real artifact ("motion rig", "model gallery"), and `note` the honest
 * cost being paid, so the wait is legible rather than merely decorated.
 */
export function DecodeSequence({ label, note }: { label: string; note?: string }) {
  return (
    <div className="cf-decode" role="status" aria-live="polite">
      <div className="cf-decode-frame" aria-hidden="true">
        <span className="cf-decode-corner tl" />
        <span className="cf-decode-corner tr" />
        <span className="cf-decode-corner bl" />
        <span className="cf-decode-corner br" />
        <span className="cf-decode-sweep" />
        <span className="cf-decode-grid" />
      </div>
      <p className="cf-decode-label">
        <span className="cf-decode-dot" aria-hidden="true" />
        Decoding {label}
      </p>
      {note ? <p className="cf-decode-note">{note}</p> : null}
    </div>
  );
}
