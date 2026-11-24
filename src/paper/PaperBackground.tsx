import { memo, useId } from 'react';
import type { PaperColor, PaperTemplate } from '../../shared/types';
import { MM } from '../lib/formats';
import { PALETTE } from '../lib/palette';

export const PAPER_STYLES: Record<PaperColor, { bg: string; line: string; strong: string; margin: string; dot: string }> = {
  // „Hell“: Gray 1 statt Weiß, Linien Gray 2/3, Randlinie Red 1 (transparent)
  white: { bg: PALETTE.slate100, line: PALETTE.slate200, strong: PALETTE.slate300, margin: 'rgba(217, 38, 50, 0.38)', dot: PALETTE.slate300 },
  yellow: { bg: '#fcf5d7', line: '#dccf9f', strong: '#c9ba82', margin: '#e9ad97', dot: '#bfae79' },
  dark: { bg: PALETTE.slate800, line: 'rgba(242, 243, 245, 0.14)', strong: 'rgba(242, 243, 245, 0.22)', margin: 'rgba(217, 38, 50, 0.45)', dot: 'rgba(242, 243, 245, 0.32)' },
};

/** Geometrie der Vorlagen in pt (prozedural, vektoriell, auflösungsunabhängig). */
export const TEMPLATE_GEOMETRY = {
  ruled: { spacing: 7.5 * MM, top: 28 * MM, bottom: 12 * MM, margin: 25 * MM },
  squared: { spacing: 5 * MM },
  dotted: { spacing: 5 * MM, radius: 0.6 },
};

interface Props {
  template: PaperTemplate;
  paperColor: PaperColor;
  /** Seitengröße in pt */
  width: number;
  height: number;
  className?: string;
  style?: React.CSSProperties;
  /** Vorschau: nur einen Ausschnitt (Breite in pt, oben links) zeigen, damit das Muster erkennbar ist. */
  crop?: { w: number; h: number };
  /** Vorschau: Linien verstärken (kleine Darstellung). */
  strokeScale?: number;
}

/**
 * Papiervorlage als SVG. Die SVG nutzt die Seiteneinheiten als viewBox und wird
 * per CSS auf die gewünschte Pixelgröße skaliert – scharf bei jedem Zoom.
 */
export const PaperBackground = memo(function PaperBackground({ template, paperColor, width, height, className, style, crop, strokeScale = 1 }: Props) {
  const uid = useId().replace(/:/g, '');
  const s = PAPER_STYLES[paperColor];
  const k = strokeScale;
  let content: React.ReactNode = null;

  if (template === 'ruled') {
    const g = TEMPLATE_GEOMETRY.ruled;
    const lines: React.ReactNode[] = [];
    for (let y = g.top; y <= height - g.bottom; y += g.spacing) {
      lines.push(<line key={y} x1={0} x2={width} y1={y} y2={y} stroke={s.line} strokeWidth={0.6 * k} />);
    }
    content = (
      <>
        {lines}
        <line x1={g.margin} x2={g.margin} y1={0} y2={height} stroke={s.margin} strokeWidth={0.7 * k} />
      </>
    );
  } else if (template === 'squared') {
    const sp = TEMPLATE_GEOMETRY.squared.spacing;
    content = (
      <>
        <defs>
          <pattern id={`sq-${uid}`} width={sp} height={sp} patternUnits="userSpaceOnUse" x={(width % sp) / 2} y={(height % sp) / 2}>
            <path d={`M ${sp} 0 L 0 0 0 ${sp}`} fill="none" stroke={s.line} strokeWidth={0.5 * k} />
          </pattern>
        </defs>
        <rect width={width} height={height} fill={`url(#sq-${uid})`} />
      </>
    );
  } else if (template === 'dotted') {
    const { spacing: sp, radius } = TEMPLATE_GEOMETRY.dotted;
    content = (
      <>
        <defs>
          <pattern id={`dt-${uid}`} width={sp} height={sp} patternUnits="userSpaceOnUse" x={(width % sp) / 2 - sp / 2} y={(height % sp) / 2 - sp / 2}>
            <circle cx={sp / 2} cy={sp / 2} r={radius * Math.sqrt(k)} fill={s.dot} />
          </pattern>
        </defs>
        <rect width={width} height={height} fill={`url(#dt-${uid})`} />
      </>
    );
  }

  return (
    <svg
      className={className}
      style={style}
      viewBox={crop ? `0 0 ${crop.w} ${crop.h}` : `0 0 ${width} ${height}`}
      preserveAspectRatio={crop ? 'xMinYMin slice' : 'none'}
      xmlns="http://www.w3.org/2000/svg"
      data-paper={template}
      aria-hidden
    >
      <rect width={width} height={height} fill={s.bg} />
      {content}
    </svg>
  );
});
