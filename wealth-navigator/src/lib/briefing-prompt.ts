/**
 * Compone el mensaje que se envía al Wealth Agent para generar el briefing
 * mensual de inversión. El contexto serializado se incrusta literalmente; el
 * `context` estructurado se envía aparte por el WS (campo context).
 */
export function buildBriefingPrompt(serializedContext: string, month: string): string {
  return `Genera el briefing mensual de inversión para el mes ${month}.

Estado actual de la planificación (úsalo como única fuente de cifras, junto con tus tools de movimientos y cartera):

${serializedContext}

Devuelve un resumen accionable y conciso en español, con estas secciones (usa encabezados en negrita):
1. **Qué aportar este mes**: cuánto y a qué plan/estrategia, según las cuotas efectivas.
2. **Señales**: si hay algún trigger disparado, indícalo y la acción (p.ej. soltar pólvora); menciona señales caducadas o sin dato relevantes.
3. **Desviaciones**: dónde lo aportado se aleja de lo planificado.
4. **Qué vigilar**: 1-2 cosas a revisar este mes.

Reglas: máximo ~150 palabras, formatea cantidades con € y 0-2 decimales, no inventes cifras que no estén en el contexto o en tus datos.`;
}
