export function LoadingScreen() {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-4"
      style={{ backgroundColor: "#0f172a" }}
    >
      <img
        src="/logo-anim.gif"
        alt="Wealth OS"
        width={96}
        height={96}
        className="animate-in fade-in duration-300"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
      <span
        className="animate-in fade-in duration-700 text-[13px] uppercase tracking-[0.22em] text-white/40"
        style={{ animationFillMode: "both", animationDelay: "300ms" }}
      >
        Wealth OS
      </span>
    </div>
  );
}
