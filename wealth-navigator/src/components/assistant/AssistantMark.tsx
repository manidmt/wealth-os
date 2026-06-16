import { type SVGProps } from "react";

/**
 * Identidad del asistente: anillo + diamante (alude a "wealth" + AI).
 * Sustituye al icono Sparkles para no parecer un placeholder de AI genérico.
 */
export function AssistantMark({
  className,
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <circle cx="12" cy="12" r="9.25" opacity={0.45} />
      <path d="M12 6.5 L15.5 12 L12 17.5 L8.5 12 Z" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="var(--background)" stroke="none" />
    </svg>
  );
}
