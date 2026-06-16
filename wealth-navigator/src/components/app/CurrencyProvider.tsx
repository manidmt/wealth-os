import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Tipos de cambio manuales: "1 unidad de X = N EUR".
 * Para mostrar un valor EUR en otra divisa: `display = eurValue / rateToEur`.
 *
 * Cuando se conecte el backend, sustituir por una llamada que devuelva el
 * snapshot de tipos guardado en /settings.
 */
const FX_TO_EUR: Record<string, number> = {
  EUR: 1,
  USD: 0.92,
  GBP: 1.17,
  CAD: 0.68,
};

export type CurrencyCode = keyof typeof FX_TO_EUR;
export const CURRENCIES: CurrencyCode[] = ["EUR", "USD", "GBP", "CAD"];

const LOCALES: Record<CurrencyCode, string> = {
  EUR: "es-ES",
  USD: "en-US",
  GBP: "en-GB",
  CAD: "en-CA",
};

type Money = {
  code: CurrencyCode;
  setCode: (c: CurrencyCode) => void;
  /** Convierte un valor en EUR a la divisa activa. */
  convert: (eur: number) => number;
  /** Formatea un valor EUR en la divisa activa, sin decimales. */
  format: (eur: number) => string;
  /** Formatea un valor EUR en la divisa activa, con un decimal. */
  format1: (eur: number) => string;
};

const Ctx = createContext<Money | null>(null);
const STORAGE_KEY = "ws.currency";

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [code, setCodeState] = useState<CurrencyCode>("EUR");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && saved in FX_TO_EUR) setCodeState(saved as CurrencyCode);
  }, []);

  const setCode = useCallback((c: CurrencyCode) => {
    setCodeState(c);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, c);
  }, []);

  const value = useMemo<Money>(() => {
    const rate = FX_TO_EUR[code] ?? 1;
    const locale = LOCALES[code];
    const fmt0 = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      maximumFractionDigits: 0,
    });
    const fmt1 = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      maximumFractionDigits: 1,
    });
    const convert = (eur: number) => eur / rate;
    return {
      code,
      setCode,
      convert,
      format: (eur) => fmt0.format(convert(eur)),
      format1: (eur) => fmt1.format(convert(eur)),
    };
  }, [code, setCode]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMoney(): Money {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useMoney must be used inside <CurrencyProvider>");
  return ctx;
}
