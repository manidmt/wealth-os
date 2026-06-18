import { type ReactNode, type RefObject } from "react";
import { ArrowUp, Square } from "lucide-react";

export function ThinkingDots() {
  return (
    <div className="inline-flex items-center gap-1 text-muted-foreground">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:120ms]" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:240ms]" />
    </div>
  );
}

/** Renderizado mínimo de markdown: párrafos, listas, **bold**, _italic_. */
export function Markdownish({ text }: { text: string }) {
  const blocks = text.split(/\n\n+/);
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        const isList = lines.every((l) => /^\s*[-*\d]/.test(l) || l.trim() === "");
        if (isList) {
          return (
            <ul key={i} className="list-disc space-y-0.5 pl-5 text-[13px]">
              {lines
                .filter((l) => l.trim())
                .map((l, j) => (
                  <li key={j}>{inline(l.replace(/^\s*[-*]\s?|^\s*\d+\.\s?/, ""))}</li>
                ))}
            </ul>
          );
        }
        return (
          <p key={i} className="text-[13.5px]">
            {inline(block)}
          </p>
        );
      })}
    </>
  );
}

function inline(s: string) {
  // bold + italic
  const parts: ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|_[^_]+_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = regex.exec(s))) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      parts.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    } else {
      parts.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return parts;
}

export function Composer({
  value,
  onChange,
  onSubmit,
  busy,
  connected,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  connected: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  return (
    <div className="border-t border-border bg-muted/20 p-3">
      <div className="flex items-end gap-2 rounded-xl border border-border bg-background px-3 py-2 focus-within:border-border-strong">
        <textarea
          ref={inputRef}
          rows={1}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = Math.min(el.scrollHeight, 180) + "px";
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder={
            connected ? "Escribe tu pregunta…  (Enter para enviar)" : "Conectando con el agente…"
          }
          disabled={!connected}
          className="max-h-[180px] flex-1 resize-none bg-transparent py-1.5 text-[13.5px] outline-none placeholder:text-muted-foreground disabled:opacity-50"
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={!value.trim() || busy || !connected}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={busy ? "Procesando" : "Enviar"}
        >
          {busy ? <Square className="h-3.5 w-3.5" /> : <ArrowUp className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
