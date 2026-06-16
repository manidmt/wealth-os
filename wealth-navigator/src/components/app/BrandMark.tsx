import { type SVGProps } from "react";

/**
 * Wealth OS brand monogram.
 * Two nested frames + a thin diagonal — editorial, geometric, no generic
 * "AI sparkle" or letterform. Uses currentColor so it adapts to the surface.
 */
export function BrandMark({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="square"
      strokeLinejoin="miter"
      className={className}
      {...props}
    >
      {/* outer frame */}
      <rect x="3" y="3" width="18" height="18" rx="1.5" />
      {/* inner offset frame, filled */}
      <rect
        x="9"
        y="9"
        width="9"
        height="9"
        rx="0.5"
        fill="currentColor"
        stroke="none"
      />
      {/* diagonal accent bisecting the inner frame */}
      <path d="M3 21 L21 3" opacity={0.35} />
    </svg>
  );
}
