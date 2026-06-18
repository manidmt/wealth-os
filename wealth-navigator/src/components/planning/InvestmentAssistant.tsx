import { useState, useRef } from "react";
import { Sparkles, RotateCw, MessageSquare } from "lucide-react";
import { SectionCard } from "@/components/app/SectionCard";
import { Markdownish, ThinkingDots, Composer } from "@/components/assistant/chat-bits";
import { useAuth } from "@/hooks/use-auth";
import { openAgentStream } from "@/lib/agent-ws";
import { buildBriefingPrompt } from "@/lib/briefing-prompt";
import { serializePlanningContext, type PlanningContext } from "@/lib/planning-context";
import { useBriefing, useSaveBriefing } from "@/lib/briefing-api";
import { formatMonth } from "@/lib/dashboard-data";

type Msg = { id: string; role: "user" | "assistant"; content: string; pending?: boolean };

export function InvestmentAssistant({
  context,
  hasPlans,
}: {
  context: PlanningContext;
  hasPlans: boolean;
}) {
  const { user } = useAuth();
  const month = context.month;
  const serialized = serializePlanningContext(context);

  const { data: briefing } = useBriefing(month);
  const saveBriefing = useSaveBriefing();

  const [streaming, setStreaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const closeRef = useRef<(() => void) | null>(null);

  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  function generate() {
    if (!user?.id) return;
    setError("");
    setDraft("");
    setStreaming(true);
    let acc = "";
    closeRef.current = openAgentStream(
      user.id,
      buildBriefingPrompt(serialized, month),
      [],
      {
        onToken: (t) => {
          acc += t;
          setDraft(acc);
        },
        onDone: () => {
          setStreaming(false);
          if (acc.trim()) saveBriefing.mutate({ period: month, content: acc });
        },
        onError: (e) => {
          setStreaming(false);
          setError(e);
        },
      },
      serialized,
    );
  }

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy || !user?.id) return;
    const userMsg: Msg = { id: crypto.randomUUID(), role: "user", content: trimmed };
    const pendingId = crypto.randomUUID();
    setMessages((m) => [
      ...m,
      userMsg,
      { id: pendingId, role: "assistant", content: "", pending: true },
    ]);
    setInput("");
    setBusy(true);
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    let acc = "";
    openAgentStream(
      user.id,
      trimmed,
      history,
      {
        onToken: (t) => {
          acc += t;
          setMessages((m) =>
            m.map((msg) => (msg.id === pendingId ? { ...msg, content: acc, pending: false } : msg)),
          );
        },
        onDone: () => setBusy(false),
        onError: (e) => {
          setMessages((m) =>
            m.map((msg) => (msg.id === pendingId ? { ...msg, content: e, pending: false } : msg)),
          );
          setBusy(false);
        },
      },
      serialized,
    );
  }

  const briefingText = streaming || draft ? draft : (briefing?.content ?? "");

  return (
    <SectionCard
      title="Asistente de inversión"
      description={`Briefing y consultas con contexto de tu planificación · ${formatMonth(month)}`}
    >
      <div className="space-y-4">
        <div>
          {briefingText ? (
            <div className="space-y-1.5 text-[13.5px] leading-relaxed">
              <Markdownish text={briefingText} />
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              {hasPlans
                ? "Genera el briefing del mes para ver qué toca."
                : "Crea un plan para generar el briefing."}
            </p>
          )}
          {error && <p className="mt-2 text-[12px] text-red-500">{error}</p>}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={generate}
              disabled={streaming || !hasPlans}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-[12.5px] font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              {briefing || draft ? (
                <RotateCw className="h-3.5 w-3.5" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {streaming
                ? "Generando…"
                : briefing || draft
                  ? "Regenerar"
                  : `Generar briefing de ${formatMonth(month)}`}
            </button>
            {briefing && !streaming && (
              <span className="text-[11px] text-muted-foreground">
                Actualizado {new Date(briefing.generated_at).toLocaleDateString("es-ES")}
              </span>
            )}
          </div>
        </div>

        <div className="border-t border-border pt-3">
          <button
            type="button"
            onClick={() => setChatOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-foreground/80 hover:text-foreground"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            {chatOpen ? "Ocultar chat" : "Preguntar al agente"}
          </button>
          {chatOpen && (
            <div className="mt-3 rounded-lg border border-border">
              <div className="max-h-72 space-y-4 overflow-y-auto px-4 py-3">
                {messages.length === 0 ? (
                  <p className="text-[12.5px] text-muted-foreground">
                    Pregunta sobre tus planes, señales o cuánto aportar.
                  </p>
                ) : (
                  messages.map((m) =>
                    m.role === "user" ? (
                      <div key={m.id} className="flex justify-end">
                        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-[13px] text-primary-foreground">
                          {m.content}
                        </div>
                      </div>
                    ) : (
                      <div key={m.id} className="text-[13px] leading-relaxed">
                        {m.pending ? <ThinkingDots /> : <Markdownish text={m.content} />}
                      </div>
                    ),
                  )
                )}
              </div>
              <Composer
                value={input}
                onChange={setInput}
                onSubmit={() => send(input)}
                busy={busy}
                connected={!!user?.id}
                inputRef={inputRef}
              />
            </div>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
