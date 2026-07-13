interface BrandMarkProps {
  compact?: boolean;
}

export function BrandMark({ compact = false }: BrandMarkProps) {
  return (
    <span className="brand-mark" aria-label="CreatorFlow">
      <span className="brand-glyph" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <b>+</b>
      </span>
      {!compact && <span className="brand-name">CreatorFlow</span>}
    </span>
  );
}
