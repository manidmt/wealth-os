# Informe de Proyecto — Wealth Studio
**Manuel Díaz-Meco · Luis Cabello**
🔗 Aplicación desplegada: [wealthos.manidmt.es](https://wealthos.manidmt.es)
📁 Repositorios:
- Frontend: [github.com/manidmt/wealth-navigator](https://github.com/manidmt/wealth-navigator)
- Backend: [github.com/manidmt/wealth-dashboard](https://github.com/manidmt/wealth-dashboard)
- Agente (Luis Cabello): [github.com/LCabelloC/wealth-agent](https://github.com/LCabelloC/wealth-agent)

---

## Versión A — Lista para entregar (~500 palabras)

---

### Idea original

La idea partió de un problema concreto y personal: llevaba tiempo controlando mis finanzas con una solución propia bastante limitada. Tengo inversiones en varias plataformas, distintas cuentas bancarias y gastos distribuidos en múltiples fuentes, y centralizar todo en un único lugar era tedioso e impreciso. Ninguna app del mercado combinaba bien el seguimiento de patrimonio neto, el control de gastos por categorías y el análisis de portfolio de inversión de forma integrada.

Decidí convertir esa fricción en un proyecto real: una plataforma web donde cualquier usuario pueda registrarse, centralizar su información financiera y consultarla —incluyendo a través de un agente conversacional especializado— de forma natural. El proyecto lo desarrollamos junto a mi compañero Luis Cabello, que se encargó principalmente del agente: yo asumí la idea, la arquitectura y toda la parte de interfaz y experiencia de usuario.

---

### Uso de la IA

El uso de IA fue honesto e intensivo en varias capas distintas.

El prompt más importante del proyecto fue darle a **Lovable** el contexto completo de la aplicación —su estructura, sus datos y sus limitaciones de UX— para que rediseñase la interfaz desde cero. No fue generar una pantalla bonita: fue explicarle qué información muestra cada sección, qué decisiones de navegación importan en una app financiera y qué jerarquía visual necesitaba el usuario. El resultado fue una interfaz profesional que habría tardado semanas en construir manualmente.

**Claude Code** me ayudó a analizar la arquitectura existente y a resolver integraciones técnicas complejas: migrar los datos a Supabase con aislamiento por usuario, cablear el agente con el frontend mediante WebSockets o configurar el despliegue. En todos los casos revisé, entendí y ajusté lo que generaba.

Para el **agente financiero** usamos modelos LLM para diseñar su comportamiento: qué herramientas de análisis necesita, cómo responde preguntas sobre gastos o portfolio, y cómo gestiona el contexto sin memoria persistente entre sesiones.

El proceso fue iterativo en tres fases: primero una versión funcional básica, luego el rediseño de interfaz, y finalmente la integración del agente y la optimización de la experiencia.

---

### Decisiones técnicas

La arquitectura separa tres capas: frontend de visualización, backend de datos y servicio de agente independiente. Esta separación fue una decisión deliberada: el agente tiene necesidades propias —acceso a datos en tiempo real, ejecución de herramientas analíticas, respuesta en streaming— que no encajan en un servidor web convencional. Mantenerlo como servicio autónomo permitió iterar su comportamiento sin riesgo de afectar al resto del sistema.

La base de datos usa **Row Level Security** a nivel de base de datos —no solo de aplicación— para que los datos de cada usuario sean inaccesibles para el resto. Esto fue imprescindible para convertir una herramienta personal en una plataforma real multiusuario.

La comunicación con el agente es por **WebSockets con streaming**, lo que elimina la percepción de latencia en preguntas que pueden tardar varios segundos en resolverse.

---

### Problemas y soluciones

El primer problema fue la **heterogeneidad de los datos financieros**: distintas divisas, tipos de activos y plataformas que debían convivir en un modelo coherente. Lo resolvimos separando tres entidades con lógica propia —movimientos, posiciones de portfolio y cierres mensuales de patrimonio— en lugar de forzarlo todo en un único modelo que mezclaría conceptos financieramente distintos.

El segundo fue **la densidad de información**. Un dashboard financiero real tiene muchos números, y la primera versión resultaba abrumadora. Varias iteraciones de diseño, ayudadas por Lovable, llevaron a una estructura en tres niveles: resumen ejecutivo arriba, detalle de gastos y portfolio en segundo plano, y movimientos individuales accesibles al profundizar.

El tercer problema fue **integrar el agente de forma útil**. La primera versión lo dejaba como una pantalla separada, poco conectada al resto. El aprendizaje fue que el agente tiene más valor cuando está integrado contextualmente: accesible desde el detalle de un mes, desde el portfolio o desde el resumen, con la pregunta prellenada con contexto relevante.

El aprendizaje global fue que pasar de una herramienta personal a una plataforma multiusuario real exige replantear casi todo. Y que usar IA para acelerar no exime de entender lo que se construye: cuando algo no funcionaba, tenía que diagnosticar el problema, no solo regenerar la respuesta.

---

### Capturas de pantalla

**Captura 1 — Dashboard principal:** Vista del KPI de patrimonio neto con cifras reales y gráfica de evolución histórica. Muestra la propuesta de valor central de un vistazo.

**Captura 2 — Agente respondiendo con datos reales:** Pantalla del asistente con una pregunta sobre gastos o portfolio y la respuesta del modelo con cifras propias, visible el streaming. Demuestra la integración LLM + datos personales.

**Captura 3 — Portfolio o detalle mensual:** Vista del portfolio con posiciones, P&L y distribución por plataforma; o el panel de detalle de un mes con los movimientos desglosados. Muestra la profundidad funcional de la app.

*(Opcional pero recomendable)* **Captura 4 — Pantalla de login / registro:** Muestra que la app es multiusuario real y que el evaluador puede registrarse y probarla en [wealthos.manidmt.es](https://wealthos.manidmt.es).

---
---

## Versión B — Más técnica y sofisticada (~500 palabras)

---

### Idea original

El proyecto nació de una necesidad real: controlaba mis finanzas con una solución propia que resultaba limitada e incómoda. Con inversiones en distintas plataformas, varias cuentas bancarias y gastos heterogéneos, centralizar y cruzar esa información requería demasiado esfuerzo manual. Decidí convertir ese problema en una aplicación real orientada a cualquier usuario interesado en el control de su patrimonio e inversiones. El proyecto lo desarrollamos en pareja: yo me responsabilicé de la idea, la arquitectura y la experiencia de usuario; Luis Cabello del agente conversacional especializado y su integración.

---

### Uso de la IA

Utilizamos IA de formas distintas según la capa del proyecto.

**Lovable** fue fundamental para el rediseño de interfaz. El prompt clave consistió en proporcionar el contexto completo de la aplicación —estructura de datos, flujos de usuario, limitaciones de la versión anterior y objetivos de usabilidad— para que propusiera y construyera una interfaz significativamente más profesional. No fue solo generación: fue comunicar qué jerarquía de información necesita un usuario financiero y por qué. Revisé y ajusté todo lo que produjo.

**Claude Code** actuó como copiloto técnico para integraciones de mayor complejidad: migración del sistema de persistencia a Supabase con Row Level Security, implementación del sistema de autenticación multiusuario, configuración del proxy WebSocket para el agente y despliegue en infraestructura propia.

Para el agente, usamos LLMs para diseñar el sistema de herramientas analíticas —funciones que calculan gasto mensual, comparativas entre períodos, desglose por categoría o resumen de portfolio— y para afinar el prompt de sistema que define su comportamiento y sus límites.

El proceso fue iterativo en tres ciclos: versión funcional inicial, rediseño de interfaz, e integración y optimización del agente.

---

### Decisiones técnicas

La arquitectura separa tres capas con responsabilidades bien delimitadas: frontend de visualización, backend de persistencia y servicio de agente independiente. Esta separación no fue arbitraria: el agente requiere capacidades —ejecución de herramientas, streaming de respuestas, acceso a datos en tiempo real— que no encajan en un servidor web convencional. Mantenerlo como servicio autónomo permitió iterar su comportamiento y sus herramientas sin afectar al resto del sistema.

El aislamiento de datos entre usuarios se implementó con **Row Level Security** a nivel de base de datos, no solo de aplicación. Esto garantiza que aunque la lógica de aplicación falle, los datos de un usuario son inaccesibles para otro a nivel de motor de base de datos.

La comunicación con el agente usa **WebSockets con streaming token a token**, lo que transforma la percepción del usuario: en vez de esperar varios segundos a una respuesta completa, la ve construirse en tiempo real, lo cual es especialmente relevante en consultas analíticas complejas.

---

### Problemas y soluciones

**Modelo de datos heterogéneo.** Los datos financieros son conceptualmente distintos: un ingreso mensual, una posición de portfolio y un cierre de patrimonio tienen naturaleza, temporalidad y lógica de cálculo muy diferentes. Forzarlos en un único modelo habría creado deuda técnica inmediata. La solución fue separar tres entidades con su propia lógica —movimientos, posiciones, cierres mensuales— que se agregan en la capa de presentación.

**Densidad de información vs. claridad.** La primera versión era funcionalmente correcta pero visualmente saturada. Varias iteraciones de diseño con Lovable llevaron a una estructura en tres niveles de profundidad: KPIs ejecutivos en primer plano, análisis por categoría y portfolio como segundo nivel, y detalle de movimientos individuales accesible al profundizar. El usuario entiende su situación en segundos y puede explorar sin perderse.

**Integración contextual del agente.** La versión inicial situaba el agente como pantalla separada, desconectada del flujo principal. El problema no era técnico sino de diseño: un asistente financiero es más útil cuando el usuario llega con contexto ya cargado. La solución fue añadir puntos de entrada contextuales —desde el resumen del mes, desde una posición del portfolio— con la pregunta prellenada. Eso cambió completamente la percepción de utilidad del agente.

El aprendizaje más honesto fue que construir con IA no elimina la necesidad de entender lo que se construye. Cuando algo fallaba —y falló varias cosas— había que diagnosticar el problema real, no solo regenerar. Esa capacidad de revisión fue lo que convirtió código generado en un producto que funciona.

---

### Capturas de pantalla

**Captura 1 — Dashboard con KPI de patrimonio:** Vista principal con el patrimonio neto real, variación mensual y gráfica de evolución histórica. Captura el valor central del proyecto.

**Captura 2 — Agente con respuesta real en streaming:** Conversación con el asistente respondiendo una pregunta financiera concreta (gastos, portfolio o patrimonio) con cifras reales del usuario. Muestra la integración LLM + datos personales funcionando.

**Captura 3 — Portfolio o detalle de mes:** Tabla de posiciones con P&L y distribución por plataforma, o el panel de movimientos de un mes con categorías. Demuestra profundidad funcional.

**Captura 4 (recomendada) — Registro en la app:** Pantalla de login/signup en wealthos.manidmt.es, demostrando que es una plataforma real, pública y multiusuario donde el evaluador puede registrarse.

---
---

## Recomendaciones concretas para maximizar la nota

**Sobre funcionalidad (30%):** Incluye la URL [wealthos.manidmt.es](https://wealthos.manidmt.es) de forma prominente al principio del informe e indica que el evaluador puede registrarse y probarlo en el momento de la evaluación. Es el 30% más fácil de asegurar.

**Sobre el informe y reflexión (30%):** El criterio dice explícitamente que "un proyecto mediocre bien explicado puntúa mejor que uno generado con IA sin revisión." La sección de problemas es donde más se nota si hubo comprensión real. Sé específico sobre qué falló y por qué, no solo que "hubo dificultades."

**Sobre originalidad (20%):** Menciona que los datos de la app son reales y propios —patrimonio propio migrado, movimientos reales— no datos de prueba inventados. Eso diferencia el proyecto de cualquier ejercicio académico genérico.

**Sobre UX (20%):** Si tienes alguna captura del antes/después del rediseño con Lovable, inclúyela. El contraste visual demuestra criterio de diseño y proceso iterativo real, que es exactamente lo que puntúa en este criterio.

**Para las capturas:** hazlas con datos reales visibles (aunque sean los tuyos), no con pantallas vacías o de demo. Una captura con un patrimonio neto real, movimientos reales y el agente respondiendo con cifras concretas comunica credibilidad inmediata.
