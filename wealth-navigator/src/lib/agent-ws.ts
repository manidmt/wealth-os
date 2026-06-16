const WS_BASE_URL =
  (import.meta.env.VITE_AGENT_WS_URL as string | undefined) ?? "ws://localhost:8001";

export type AgentHandlers = {
  onToken: (token: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
};

export type AgentMessage = { role: "user" | "assistant"; content: string };

/**
 * Abre un WS al agente, envía {message, history} y enruta los eventos de stream.
 * Devuelve una función para cerrar/abortar la conexión.
 */
export function openAgentStream(
  userId: string,
  message: string,
  history: AgentMessage[],
  handlers: AgentHandlers,
): () => void {
  let settled = false;
  const ws = new WebSocket(`${WS_BASE_URL}/ws/${userId}`);

  const timeout = setTimeout(() => {
    if (!settled && ws.readyState !== WebSocket.OPEN) {
      settled = true;
      handlers.onError("El agente no está disponible ahora.");
      ws.close();
    }
  }, 5000);

  ws.onopen = () => {
    ws.send(JSON.stringify({ message, history }));
  };

  ws.onmessage = (ev) => {
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (typeof parsed?.token === "string") {
      handlers.onToken(parsed.token as string);
      return;
    }
    if (parsed?.done) {
      settled = true;
      clearTimeout(timeout);
      handlers.onDone();
      ws.close();
      return;
    }
    if (parsed?.error) {
      settled = true;
      clearTimeout(timeout);
      handlers.onError(String(parsed.error));
      ws.close();
    }
  };

  ws.onerror = () => {
    if (!settled) {
      settled = true;
      clearTimeout(timeout);
      handlers.onError("El agente no está disponible ahora.");
    }
  };

  ws.onclose = () => {
    clearTimeout(timeout);
  };

  return () => {
    clearTimeout(timeout);
    ws.close();
  };
}

export const AGENT_WS_BASE_URL = WS_BASE_URL;
