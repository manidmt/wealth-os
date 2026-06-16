import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { CommandBar } from "./CommandBar";

type Ctx = { open: () => void; close: () => void; toggle: () => void };
const AssistantCtx = createContext<Ctx | null>(null);

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const value: Ctx = {
    open: useCallback(() => setOpen(true), []),
    close: useCallback(() => setOpen(false), []),
    toggle: useCallback(() => setOpen((v) => !v), []),
  };

  return (
    <AssistantCtx.Provider value={value}>
      {children}
      <CommandBar open={open} onOpenChange={setOpen} />
    </AssistantCtx.Provider>
  );
}

export function useAssistant() {
  const ctx = useContext(AssistantCtx);
  if (!ctx) throw new Error("useAssistant must be used within AssistantProvider");
  return ctx;
}
