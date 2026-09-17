import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { openAgentStream } from "./agent-ws";

class FakeWS {
  static last: FakeWS | null = null;
  url: string;
  protocols: string | string[] | undefined;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols;
    FakeWS.last = this;
  }
  send(data: string) { this.sent.push(data); }
  close() {}
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeWS as unknown as typeof WebSocket);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const noop = { onToken: () => {}, onDone: () => {}, onError: () => {} };

describe("openAgentStream payload", () => {
  it("includes context when provided", () => {
    openAgentStream("u1", "tok1", "hola", [], noop, "CTX-BLOCK");
    FakeWS.last!.onopen!();
    const payload = JSON.parse(FakeWS.last!.sent[0]);
    expect(payload.message).toBe("hola");
    expect(payload.context).toBe("CTX-BLOCK");
  });

  it("omits context when not provided", () => {
    openAgentStream("u1", "tok1", "hola", [], noop);
    FakeWS.last!.onopen!();
    const payload = JSON.parse(FakeWS.last!.sent[0]);
    expect(payload.message).toBe("hola");
    expect("context" in payload).toBe(false);
  });

  it("sends the token as a subprotocol, not in the URL", () => {
    openAgentStream("u1", "tok1", "hola", [], noop);
    expect(FakeWS.last!.url.endsWith("/ws/u1")).toBe(true);
    expect(FakeWS.last!.url).not.toContain("tok1");
    expect(FakeWS.last!.protocols).toEqual(["bearer", "tok1"]);
  });
});
