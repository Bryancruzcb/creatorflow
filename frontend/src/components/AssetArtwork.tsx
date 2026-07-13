import type { AssetKind } from '../data';

export function AssetArtwork({
  kind,
  title,
  previewUrl,
  version = 'project',
  similarity = 100,
}: {
  kind: AssetKind;
  title?: string;
  previewUrl?: string;
  version?: 'project' | 'source';
  similarity?: number;
}) {
  const label = title ? `${title} preview` : `${kind} asset preview`;
  const isSource = version === 'source';
  const lowConfidence = similarity < 60;

  if (kind === 'model') {
    return <img className="asset-art asset-art-model" src={previewUrl ?? '/assets/avocado-source.jpg'} alt={label} />;
  }

  if (kind === 'wave') {
    return (
      <svg className="asset-art" viewBox="0 0 320 180" role="img" aria-label={label}>
        <rect width="320" height="180" fill={isSource ? '#201B18' : '#171815'} />
        <path d="M0 90H320" stroke={isSource ? '#5B3E33' : '#34352F'} />
        {Array.from({ length: 64 }).map((_, index) => {
          const height = isSource && lowConfidence
            ? 8 + ((index * 11 + Math.floor(index / 7) * 31) % 118)
            : 14 + ((index * 23) % 58);
          return <rect key={index} x={index * 5 + 1} y={90 - height / 2} width={isSource ? 3 : 2} height={height} fill={isSource ? (index % 5 === 0 ? '#C16A43' : '#A79A83') : (index % 7 === 0 ? '#5F7FA0' : '#8D918A')} />;
        })}
        <text x="14" y="22" fill={isSource ? '#D8916F' : '#81A6CC'} fontFamily="monospace" fontSize="9">{isSource ? 'SOURCE · SHARP TRANSIENT / SHORT TAIL' : 'PROJECT · SOFT ATTACK / LOW-FREQUENCY TAIL'}</text>
      </svg>
    );
  }

  if (kind === 'sprite') {
    return (
      <svg className="asset-art" viewBox="0 0 320 180" role="img" aria-label={label}>
        <rect width="320" height="180" fill={isSource ? '#211A18' : '#191A17'} />
        {Array.from({ length: isSource ? 12 : 10 }).map((_, index) => {
          const columns = isSource ? 4 : 5;
          const x = 14 + (index % columns) * (isSource ? 76 : 61);
          const y = 14 + Math.floor(index / columns) * (isSource ? 54 : 82);
          const shift = index % 3;
          return (
            <g key={index} transform={`translate(${x} ${y})`}>
              <rect width={isSource ? 62 : 50} height={isSource ? 44 : 70} fill={isSource ? '#2C2521' : '#22231F'} stroke={isSource ? '#6E4736' : '#34352F'} />
              {isSource ? (
                <><rect x={16 + shift} y="8" width="23" height="12" rx="2" fill="#D4865F" /><path d={`M26 21L13 ${31 + shift}M29 22L48 ${29 - shift}M23 31H46`} stroke="#F2D9C8" strokeWidth="4" strokeLinecap="square" /></>
              ) : (
                <><circle cx={25 + shift} cy="17" r="7" fill="#A7A69E" /><path d={`M25 ${27 + shift} L${16 + shift} 48 M25 ${27 + shift} L${36 - shift} 47 M25 ${29 + shift} L25 56 M25 55 L${17 - shift} 67 M25 55 L${35 + shift} 66`} stroke="#F1F0EA" strokeWidth="3" strokeLinecap="round" /></>
              )}
            </g>
          );
        })}
      </svg>
    );
  }

  if (kind === 'icons') {
    return (
      <svg className="asset-art" viewBox="0 0 320 180" role="img" aria-label={label}>
        <rect width="320" height="180" fill={isSource ? '#1D1A22' : '#191A17'} />
        {Array.from({ length: 18 }).map((_, index) => {
          const x = 24 + (index % 6) * 49;
          const y = 24 + Math.floor(index / 6) * 49;
          return isSource
            ? <circle key={index} cx={x + 14} cy={y + 14} r={index % 3 === 0 ? 13 : 9} fill={index % 4 === 0 ? '#A86B45' : 'none'} stroke="#C7A889" strokeWidth="1.5" />
            : <rect key={index} x={x} y={y} width="28" height="28" rx="2" fill={index % 4 === 0 ? '#5F7FA0' : 'none'} stroke="#7B7E76" />;
        })}
      </svg>
    );
  }

  if (kind === 'font') {
    return (
      <svg className="asset-art" viewBox="0 0 320 180" role="img" aria-label={label}>
        <rect width="320" height="180" fill={isSource ? '#211C18' : '#191A17'} />
        <text x="18" y="78" fill={isSource ? '#D9AF84' : '#E8E7DF'} fontFamily={isSource ? 'Georgia, serif' : 'Arial, sans-serif'} fontWeight={isSource ? '400' : '700'} fontSize="72">Aa4</text>
        <path d="M18 104H302" stroke={isSource ? '#6B4B34' : '#3D403A'} />
        <text x="18" y="128" fill={isSource ? '#C9885C' : '#82A8CB'} fontFamily="monospace" fontSize="10">{isSource ? 'SINGLE-STOREY · ROUNDED TERMINALS' : 'DOUBLE-STOREY · SHARP TERMINALS'}</text>
        <text x="18" y="154" fill="#8A8D85" fontFamily={isSource ? 'Georgia, serif' : 'Arial, sans-serif'} fontSize="17">Hamburgefons 012345</text>
      </svg>
    );
  }

  if (kind === 'video') {
    const projectFrames = ['M18 112L62 60L108 112Z', 'M124 42H194V112H124Z', 'M210 112L254 52L302 112Z'];
    const sourceFrames = ['M16 48H108V112H16Z', 'M120 112L156 52L198 112Z', 'M210 48H302V112H210Z'];
    return (
      <svg className="asset-art" viewBox="0 0 320 180" role="img" aria-label={label}>
        <rect width="320" height="180" fill={isSource ? '#241B18' : '#171A1D'} />
        {(isSource ? sourceFrames : projectFrames).map((path, index) => <path key={path} d={path} fill={isSource ? ['#9D4F33', '#D09A57', '#5A332B'][index] : ['#31536A', '#7A8179', '#9EB7C5'][index]} />)}
        {[14, 116, 208].map((x) => <rect key={x} x={x} y="38" width="96" height="80" fill="none" stroke={isSource ? '#8B5F4A' : '#4F5D63'} />)}
        <path d={isSource ? 'M14 142H72V149H116V142H194V149H208V142H306' : 'M14 149H58V142H146V149H238V142H306'} fill="none" stroke={isSource ? '#D58259' : '#78A5C7'} strokeWidth="3" />
        <text x="14" y="24" fill={isSource ? '#D58259' : '#78A5C7'} fontFamily="monospace" fontSize="9">{isSource ? 'SOURCE · FACTORY / VEHICLE / CITY' : 'PROJECT · FOREST / CHARACTER / ORBIT'}</text>
      </svg>
    );
  }

  if (kind === 'receipt') {
    return (
      <svg className="asset-art asset-art-light" viewBox="0 0 320 180" role="img" aria-label={label}>
        <rect width="320" height="180" fill="#D5D2C8" />
        <path d="M26 34H294M26 56H210M26 98H294M26 120H250M26 142H180" stroke="#595A54" strokeWidth="2" />
        <rect x="225" y="49" width="68" height="31" fill="none" stroke="#7A3B2E" />
        <text x="236" y="69" fill="#7A3B2E" fontSize="11" fontFamily="monospace">LICENSE</text>
      </svg>
    );
  }

  if (kind === 'texture') {
    return (
      <svg className="asset-art" viewBox="0 0 320 180" role="img" aria-label={label}>
        <rect width="320" height="180" fill="#20211D" />
        {Array.from({ length: 36 }).map((_, index) => {
          const x = (index * 47) % 320;
          const y = (index * 79) % 180;
          const radius = 12 + (index % 5) * 6;
          return <circle key={index} cx={x} cy={y} r={radius} fill="none" stroke={index % 4 === 0 ? '#5F7FA0' : '#45463F'} strokeWidth="2" />;
        })}
      </svg>
    );
  }

  if (kind === 'mesh') {
    return (
      <svg className="asset-art" viewBox="0 0 320 180" role="img" aria-label={label}>
        <rect width="320" height="180" fill={isSource ? '#231D19' : '#191B18'} />
        {isSource ? (
          <g fill="#5C4435" stroke="#D2986D" strokeWidth="2"><path d="M28 140L48 38L91 21L118 140Z" /><path d="M108 140L136 57L169 31L196 140Z" /><path d="M183 140L223 49L276 35L300 140Z" /><path d="M48 38L118 140M91 21L28 140M136 57L196 140M169 31L108 140M223 49L300 140M276 35L183 140" fill="none" opacity="0.65" /></g>
        ) : (
          <g fill="#384139" stroke="#94A296" strokeWidth="2"><path d="M24 138L43 85L89 61L117 102L102 143Z" /><path d="M92 143L126 72L170 57L201 111L177 145Z" /><path d="M170 144L213 91L263 69L300 127L282 145Z" /><path d="M34 111L102 143M126 72L177 145M213 91L282 145" fill="none" opacity="0.62" /></g>
        )}
        <text x="16" y="22" fill={isSource ? '#D2986D' : '#8FB59A'} fontFamily="monospace" fontSize="9">{isSource ? 'SOURCE · TALL 3-PIECE OUTCROP' : 'PROJECT · LOW 5-STONE CLUSTER'}</text>
      </svg>
    );
  }

  return (
    <svg className="asset-art" viewBox="0 0 640 420" role="img" aria-label={label}>
      <rect width="640" height="420" fill="#22231F" />
      <path d="M0 346L108 225L178 287L277 142L356 247L465 108L640 300V420H0Z" fill="#4A4B43" />
      <path d="M0 379L122 270L204 318L311 190L388 278L487 164L640 329V420H0Z" fill="#65675E" />
      <path d="M0 397L150 316L250 349L355 261L460 319L549 254L640 357V420H0Z" fill="#292A26" />
      <path d="M278 143L316 191L293 198L333 243M465 109L420 205L453 194L439 246" fill="none" stroke="#96978E" strokeWidth="4" opacity="0.7" />
      <g stroke="#C3C2BA" opacity="0.65">
        <path d="M304 210V260M279 235H329" />
        <path d="M22 22H62M22 22V62M618 22H578M618 22V62M22 398H62M22 398V358M618 398H578M618 398V358" />
      </g>
    </svg>
  );
}
