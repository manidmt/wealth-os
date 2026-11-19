import { type SVGProps } from "react";

/**
 * Wealth OS logo mark: the "W" drawn as a single market zig-zag line,
 * matching the animated splash logo (scripts/logo_anim.py). Uses
 * currentColor so it adapts to the surface.
 */
export function LogoMark({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <polyline points="2,2 7,22 12,13 17,22 22,2" />
    </svg>
  );
}
