import { useEffect, useRef, useState } from "react";
import { MessageCircle, X, Send } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

const WS_BASE_URL =
  (import.meta.env.VITE_AGENT_WS_URL as string | undefined) ?? "ws://localhost:8000";

type Msg = { role: "user" | "system"; content: string; id: string };

export function AgentChatWidget() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || !user?.id) return;
    const ws = new WebSocket(`${WS_BASE_URL}/ws/${user.id}`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    let streamingId: string | null = null;
    ws.onmessage = (ev) => {
      let parsed: any = null;
      try {
        parsed = JSON.parse(ev.data);
      } catch {
        // plain text fallback
        setMessages((m) => [
          ...m,
          { role: "system", content: ev.data as string, id: crypto.randomUUID() },
        ]);
        return;
      }

      if (typeof parsed?.token === "string") {
        const token = parsed.token;
        if (!streamingId) {
          const id = crypto.randomUUID();
          streamingId = id;
          setMessages((m) => [...m, { role: "system", content: token, id }]);
        } else {
          const id = streamingId;
          setMessages((m) =>
            m.map((msg) => (msg.id === id ? { ...msg, content: msg.content + token } : msg)),
          );
        }
        return;
      }

      if (parsed?.done) {
        streamingId = null;
        return;
      }

      const content = parsed.message ?? parsed.content ?? parsed.text;
      if (typeof content === "string") {
        setMessages((m) => [...m, { role: "system", content, id: crypto.randomUUID() }]);
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [open, user?.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function send() {
    const text = input.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const history = messages.map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
    }));
    wsRef.current.send(JSON.stringify({ message: text, history }));
    setMessages((m) => [...m, { role: "user", content: text, id: crypto.randomUUID() }]);
    setInput("");
  }

  if (!user) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Cerrar chat" : "Abrir chat"}
        className="fixed bottom-6 right-6 z-50 grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg transition hover:opacity-90"
      >
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-6 w-6" />}
      </button>

      {open && (
        <div className="fixed bottom-24 right-6 z-50 flex h-[520px] w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <div className="text-[13px] font-semibold tracking-tight">Agente</div>
              <div className="text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground">
                {connected ? "Conectado" : "Desconectado"}
              </div>
            </div>
            <span
              className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
            />
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.length === 0 ? (
              <div className="grid h-full place-items-center text-center text-[12px] text-muted-foreground">
                Escribe un mensaje para empezar.
              </div>
            ) : (
              messages.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-3 py-2 text-[13px] text-primary-foreground">
                      {m.content}
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className="flex justify-start">
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-md bg-muted px-3 py-2 text-[13px] text-foreground">
                      {m.content}
                    </div>
                  </div>
                ),
              )
            )}
          </div>

          <div className="border-t border-border bg-muted/20 p-2">
            <div className="flex items-end gap-2 rounded-lg border border-border bg-background px-2 py-1.5 focus-within:border-border-strong">
              <textarea
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="Escribe…"
                className="max-h-32 flex-1 resize-none bg-transparent py-1 text-[13px] outline-none placeholder:text-muted-foreground"
              />
              <button
                type="button"
                onClick={send}
                disabled={!input.trim() || !connected}
                className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground disabled:opacity-40"
                aria-label="Enviar"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
