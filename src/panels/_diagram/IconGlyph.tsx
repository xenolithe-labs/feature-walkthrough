import type { ResolvedIcon } from './icons';

/** An icon: one `<path>` in a square box. Nothing but path data is ever drawn. */
export function IconGlyph({ icon }: { icon: ResolvedIcon }) {
  return (
    <svg
      className="fw-icon"
      viewBox={`0 0 ${icon.size} ${icon.size}`}
      data-fill={icon.fill ? '' : undefined}
      aria-hidden="true"
      focusable="false"
    >
      <path d={icon.d} />
    </svg>
  );
}
