// MCC (ISO 18245) → categoría de la app. Estándar, agnóstico al banco.
// null = ambiguo/desconocido → lo resuelve la capa LLM.
const MCC_MAP: Record<string, string> = {
  // Comida / supermercados
  "5411": "Comida", "5422": "Comida", "5451": "Comida", "5462": "Comida", "5499": "Comida",
  // Comer fuera
  "5811": "Comer fuera", "5812": "Comer fuera", "5814": "Comer fuera",
  // Transporte
  "4111": "Transporte", "4112": "Transporte", "4121": "Transporte", "4131": "Transporte", "4789": "Transporte",
  // Coche
  "5541": "Coche", "5542": "Coche", "7523": "Coche", "7538": "Coche", "7549": "Coche",
  // Viaje
  "4511": "Viaje", "4722": "Viaje", "7011": "Viaje", "7512": "Viaje",
  // Salud
  "5912": "Salud", "8011": "Salud", "8021": "Salud", "8042": "Salud", "8043": "Salud", "8062": "Salud",
  // Gimnasio / deporte
  "7997": "Gimnasio", "7941": "Gimnasio", "5940": "Deporte", "5941": "Deporte",
  // Ropa
  "5611": "Ropa", "5621": "Ropa", "5631": "Ropa", "5651": "Ropa", "5691": "Ropa", "5699": "Ropa",
  // Tecnología
  "5045": "Tecnología", "5732": "Tecnología", "5734": "Tecnología", "7372": "Tecnología",
  // Suscripciones / digital
  "4899": "Suscripciones", "5815": "Suscripciones", "5816": "Suscripciones", "5817": "Suscripciones", "5818": "Suscripciones",
  // Hogar / suministros / telecom
  "4814": "Hogar", "4900": "Hogar", "5200": "Hogar", "5211": "Hogar", "5251": "Hogar",
  // Ocio
  "7832": "Ocio", "7841": "Ocio", "7922": "Ocio", "7929": "Ocio", "7996": "Ocio", "5813": "Ocio",
  // Educación / formación
  "8211": "Educación", "8220": "Educación", "8241": "Educación", "8299": "Educación", "5942": "Educación",
  // Impuestos / administración
  "9311": "Impuestos", "9222": "Impuestos", "9399": "Impuestos",
  // Cuidado personal
  "7230": "Cuidado personal", "7298": "Cuidado personal", "5977": "Cuidado personal",
  // Regalo
  "5947": "Regalo",
};

export function categoryFromMcc(mcc: string | null | undefined): string | null {
  if (!mcc) return null;
  return MCC_MAP[mcc.trim()] ?? null;
}
