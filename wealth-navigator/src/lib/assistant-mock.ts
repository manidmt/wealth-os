import { euro1, formatMonth, type DashboardData, type SeriesPoint } from "./dashboard-data";

export type Suggestion = {
  id: string;
  label: string;
  prompt: string;
  scope: "resumen" | "gastos" | "portfolio" | "patrimonio" | "saldos";
};

export const SUGGESTIONS: Suggestion[] = [
  {
    id: "s1",
    label: "Resumen del mes",
    prompt: "Dame un resumen ejecutivo del cierre actual.",
    scope: "resumen",
  },
  {
    id: "s2",
    label: "¿En qué gasté más este mes?",
    prompt: "¿Cuáles son mis 3 categorías de gasto más altas y cómo evolucionan?",
    scope: "gastos",
  },
  {
    id: "s3",
    label: "Concentración del portfolio",
    prompt: "¿Estoy sobreexpuesto a alguna plataforma o tipo de activo?",
    scope: "portfolio",
  },
  {
    id: "s4",
    label: "Crecimiento del patrimonio",
    prompt: "¿Cómo ha evolucionado mi patrimonio neto en los últimos 12 meses?",
    scope: "patrimonio",
  },
  {
    id: "s5",
    label: "Tasa de ahorro",
    prompt: "¿Cuál es mi tasa de ahorro media de los últimos 3 meses?",
    scope: "gastos",
  },
  {
    id: "s6",
    label: "Cierres pendientes",
    prompt: "¿Tengo algún saldo o cierre pendiente de actualizar?",
    scope: "saldos",
  },
];

export type Playbook = {
  id: string;
  title: string;
  description: string;
  steps: string[];
};

export const PLAYBOOKS: Playbook[] = [
  {
    id: "monthly-review",
    title: "Revisión mensual",
    description: "Recorre el cierre del mes: variación, ahorro, top categorías y posiciones.",
    steps: [
      "Resume el cierre del mes en una frase.",
      "Lista top 3 categorías de gasto y compáralas con el mes anterior.",
      "Indica si hubo movimientos relevantes en el portfolio.",
    ],
  },
  {
    id: "rebalance-check",
    title: "Rebalance check",
    description: "Detecta desviaciones de allocation respecto al objetivo y propone ajustes.",
    steps: [
      "Calcula el peso actual de cada tipo de activo.",
      "Compara con el target de allocation.",
      "Propone movimientos para volver al target.",
    ],
  },
  {
    id: "spend-stress",
    title: "Stress test de gastos",
    description: "Simula escenarios de gasto extra y mide el impacto en el ahorro anual.",
    steps: [
      "Calcula gasto medio mensual de los últimos 6 meses.",
      "Aplica un +15% y muestra el efecto en la tasa de ahorro.",
      "Sugiere 2 categorías con margen de optimización.",
    ],
  },
];

export type Insight = {
  id: string;
  tone: "neutral" | "positive" | "warning";
  title: string;
  body: string;
  prompt: string;
};

export function computeInsights(data: DashboardData): Insight[] {
  const months = data.expenses.byMonth;
  const cur = months[months.length - 1];
  const prev = months[months.length - 2];
  const series: SeriesPoint[] = data.series;
  const last = series[series.length - 1];
  const sixAgo = series[series.length - 7] ?? series[0];

  const insights: Insight[] = [];

  if (prev) {
    const delta = (cur.expenseTotal - prev.expenseTotal) / Math.max(prev.expenseTotal, 1);
    const pct = (delta * 100).toFixed(0);
    insights.push({
      id: "i-spend",
      tone: delta > 0.1 ? "warning" : delta < -0.05 ? "positive" : "neutral",
      title:
        delta > 0
          ? `Gasto ${pct}% por encima del mes anterior`
          : `Gasto ${Math.abs(Number(pct))}% por debajo del mes anterior`,
      body: `Pasaste de ${euro1.format(prev.expenseTotal)} en ${formatMonth(prev.month)} a ${euro1.format(cur.expenseTotal)} en ${formatMonth(cur.month)}.`,
      prompt: "Explícame qué categorías están detrás del cambio de gasto del mes.",
    });
  }

  if (sixAgo && last) {
    const growth = last.netWorth - sixAgo.netWorth;
    const growthPct = sixAgo.netWorth > 0 ? (growth / sixAgo.netWorth) * 100 : 0;
    insights.push({
      id: "i-growth",
      tone: growth >= 0 ? "positive" : "warning",
      title: `Patrimonio ${growth >= 0 ? "+" : ""}${euro1.format(growth)} en 6 meses`,
      body: `Variación del ${growthPct.toFixed(1)}% desde ${formatMonth(sixAgo.month)} hasta ${formatMonth(last.month)}.`,
      prompt: "¿Qué activos han contribuido más al crecimiento del patrimonio en los últimos 6 meses?",
    });
  }

  // Concentración de portfolio
  const platforms = data.portfolio.byPlatform;
  if (platforms.length) {
    const total = platforms.reduce((a, b) => a + b.value, 0);
    const top = [...platforms].sort((a, b) => b.value - a.value)[0];
    const share = total > 0 ? (top.value / total) * 100 : 0;
    insights.push({
      id: "i-concentration",
      tone: share > 40 ? "warning" : "neutral",
      title: `${top.label} concentra el ${share.toFixed(0)}% del portfolio`,
      body: `${euro1.format(top.value)} sobre ${euro1.format(total)} totales en plataformas.`,
      prompt: `¿Debería diversificar fuera de ${top.label}?`,
    });
  }

  return insights.slice(0, 3);
}

/* ----------------------------- Mock responder ----------------------------- */

const CANNED: { match: RegExp; reply: (q: string, data: DashboardData) => string }[] = [
  {
    match: /resumen|cierre|mes/i,
    reply: (_q: string, data: DashboardData) => {
      const cur = data.expenses.byMonth[data.expenses.byMonth.length - 1];
      return [
        `**Cierre ${formatMonth(data.latestMonth)}**`,
        ``,
        `- Patrimonio neto: **${euro1.format(data.summary.netWorth)}** (Δ ${euro1.format(data.summary.monthlyChange)} vs mes anterior).`,
        `- Ingresos del mes: ${euro1.format(data.expenses.currentMonthIncome)} · Gastos: ${euro1.format(data.expenses.currentMonthTotal)}.`,
        `- Neto del mes: **${euro1.format(cur.net)}**.`,
        ``,
        `_Respuesta simulada — pendiente de cablear backend._`,
      ].join("\n");
    },
  },
  {
    match: /gast|categor/i,
    reply: (_q: string, data: DashboardData) => {
      const top = data.expenses.currentMonthCategories.slice(0, 3);
      return [
        `Top categorías de gasto en ${formatMonth(data.expenses.currentMonth)}:`,
        ``,
        ...top.map((c, i) => `${i + 1}. **${c.label}** — ${euro1.format(c.value)}`),
        ``,
        `_Respuesta simulada._`,
      ].join("\n");
    },
  },
  {
    match: /portfolio|posici|allocation|plataforma|concentr|diversif/i,
    reply: (_q: string, data: DashboardData) => {
      const top = [...data.portfolio.byPlatform].sort((a, b) => b.value - a.value).slice(0, 3);
      const total = data.portfolio.byPlatform.reduce((a, b) => a + b.value, 0);
      return [
        `Distribución por plataforma (top 3 sobre ${euro1.format(total)}):`,
        ``,
        ...top.map((p) => `- **${p.label}** — ${euro1.format(p.value)} (${((p.value / total) * 100).toFixed(0)}%)`),
        ``,
        `_Respuesta simulada._`,
      ].join("\n");
    },
  },
  {
    match: /patrimonio|evoluci|crecimiento/i,
    reply: (_q: string, data: DashboardData) => {
      const s = data.series;
      const first = s[0];
      const last = s[s.length - 1];
      const growth = last.netWorth - first.netWorth;
      return [
        `Evolución desde ${formatMonth(first.month)} hasta ${formatMonth(last.month)}:`,
        ``,
        `- Inicio: ${euro1.format(first.netWorth)}`,
        `- Cierre: **${euro1.format(last.netWorth)}**`,
        `- Crecimiento total: ${euro1.format(growth)}`,
        ``,
        `_Respuesta simulada._`,
      ].join("\n");
    },
  },
  {
    match: /ahorro|saving/i,
    reply: (_q: string, data: DashboardData) => {
      const last3 = data.expenses.byMonth.slice(-3);
      const avgIncome =
        last3.reduce((a, b) => a + b.incomeTotal, 0) / Math.max(last3.length, 1);
      const avgNet = last3.reduce((a, b) => a + b.net, 0) / Math.max(last3.length, 1);
      const rate = avgIncome > 0 ? (avgNet / avgIncome) * 100 : 0;
      return [
        `Tasa de ahorro media (últimos 3 meses): **${rate.toFixed(0)}%**`,
        ``,
        `Ingresos medios: ${euro1.format(avgIncome)} · Neto medio: ${euro1.format(avgNet)}.`,
        ``,
        `_Respuesta simulada._`,
      ].join("\n");
    },
  },
];

export async function mockAnswer(question: string, data: DashboardData): Promise<string> {
  await new Promise((r) => setTimeout(r, 450 + Math.random() * 350));
  const hit = CANNED.find((c) => c.match.test(question));
  if (hit) return hit.reply(question, data);
  return [
    `Aún no tengo una respuesta entrenada para esa pregunta.`,
    ``,
    `Cuando enchufes el backend del agente, esta respuesta vendrá del modelo con acceso a tus stores.`,
    ``,
    `_Respuesta simulada._`,
  ].join("\n");
}
