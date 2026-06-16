import { cn } from "@/lib/utils";

const PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const LOGOS: Record<string, string> = {
  "MyInvestor": "https://cms.myinvestor.es/uploads/logo_deccd2ad04.jpg",
  "Trade Republic": "https://forbes.es/wp-content/uploads/2023/09/fotonoticia_20230918181846_9999.jpg",
  "IBRK": "https://play-lh.googleusercontent.com/SzHSJM8ojWRlAmEm8Nhhaepv_La_J4HwD3JCPsda5manuEooO7E2_ab4_r754FHEFzbh",
  "Interactive Brokers": "https://play-lh.googleusercontent.com/SzHSJM8ojWRlAmEm8Nhhaepv_La_J4HwD3JCPsda5manuEooO7E2_ab4_r754FHEFzbh",
  "Criptan": "https://play-lh.googleusercontent.com/P58BxwlWlDiVSUODS91YKxlhuQFu299qxDENPvQizz3mCQ5DioDggQgmNNRhrTGtqfg",
  "BBVA": "https://www.bilbaodendak.eus/wp-content/uploads/elementor/thumbs/logo-bbva-pmkywerpbmsdtsruze4gscaschx56jtheacrqxvn48.jpg",
  "Santander": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQs984Sh2LUQlqtHZ1DRv3yEgBdvFSdyhYoFw&s",
};

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "·";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function PlatformBadge({
  name,
  className,
  size = "sm",
}: {
  name: string;
  className?: string;
  size?: "xs" | "sm";
}) {
  const color = PALETTE[hash(name) % PALETTE.length];
  const dim = size === "xs" ? "h-5 w-5 text-[9px]" : "h-6 w-6 text-[10px]";
  const logoSrc = LOGOS[name];

  return (
    <span
      className={cn("inline-flex items-center gap-2 text-[12px] text-foreground", className)}
    >
      {logoSrc ? (
        <img
          src={logoSrc}
          alt={name}
          aria-hidden
          className={cn("shrink-0 rounded-md object-contain bg-white", dim)}
        />
      ) : (
        <span
          aria-hidden
          className={cn(
            "inline-grid shrink-0 place-items-center rounded-md font-mono font-semibold tracking-tight text-white",
            dim,
          )}
          style={{
            background: `color-mix(in oklab, ${color} 80%, black 0%)`,
            boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${color} 60%, white 0%)`,
          }}
        >
          {initials(name)}
        </span>
      )}
      <span className="truncate">{name}</span>
    </span>
  );
}
