import json
from openai import AsyncOpenAI
from app.config import OPENAI_API_KEY, MODEL
from app.tools.financial_tools import TOOLS_SCHEMA, dispatch_tool
from app.services.data_service import load_user_data, get_supabase_client
from app.services.memory_service import (
    load_memory,
    load_recent_messages,
    save_turn,
    maybe_compact,
    memory_block,
)

client = AsyncOpenAI(api_key=OPENAI_API_KEY)


def build_system_prompt(df_movements_recent):
    if df_movements_recent.empty or df_movements_recent["date"].isna().all():
        from datetime import date as _date
        data_max_date = _date.today().strftime("%Y-%m-%d")
        data_current_month = _date.today().strftime("%Y-%m")
    else:
        data_max_date = df_movements_recent["date"].max().strftime("%Y-%m-%d")
        data_current_month = df_movements_recent["date"].max().strftime("%Y-%m")
    return f"""Eres un asistente financiero personal especializado en análisis de gastos e inversiones.

                Tienes acceso a datos REALES del usuario mediante herramientas (tools): sus movimientos bancarios y su portfolio de inversión completo (posiciones, valor, P&L y peso de cada una).

                CONTEXTO DE DATOS:
                - Fecha más reciente en los datos: {data_max_date}
                - Mes actual a efectos de análisis: {data_current_month}
                - Usa siempre este mes cuando el usuario diga "este mes" o "ahora"

                HERRAMIENTAS DISPONIBLES (llámalas ANTES de responder con cifras o análisis):
                - get_portfolio_summary: posiciones del portfolio con su valor, P&L y PESO/concentración. Úsala para cualquier pregunta sobre cartera, concentración, pesos, posiciones, asignación o exposición.
                - get_net_worth_summary: patrimonio neto.
                - get_month_spend / get_top_categories / get_month_comparison / get_category_trend / get_live_savings_summary: gastos, categorías y ahorro.

                REGLA CLAVE: NUNCA digas que no puedes ver el portfolio, las posiciones o los datos del usuario — SÍ puedes, con las tools. Si la pregunta toca el portfolio o la concentración, llama SIEMPRE a get_portfolio_summary primero y responde con los pesos reales (qué posiciones pesan más y dónde hay sobreconcentración).

                PRINCIPIOS:
                - Responde siempre en español
                - Sé directo; en análisis de inversión puedes extenderte algo más (hasta ~6-8 frases) si aporta valor
                - Usa siempre los datos reales de las tools, nunca inventes cifras
                - Formatea cantidades siempre con € y dos decimales
                - Sobre inversión puedes razonar sobre riesgo, concentración, diversificación y estrategia (no des garantías de rentabilidad ni predicciones de precios concretos)
                - Si la pregunta no está relacionada con finanzas personales, gastos o inversiones, responde ÚNICAMENTE con: "Lo siento, solo puedo ayudarte con consultas sobre tus finanzas personales."

                SCOPE:
                ✅ Gastos mensuales y por categoría
                ✅ Comparaciones entre meses
                ✅ Portfolio, posiciones, pesos, concentración y diversificación
                ✅ Patrimonio neto y ahorro
                ✅ Tendencias de categorías y razonamiento de estrategia de inversión

                ❌ Gráficos o visualizaciones
                ❌ Garantías de rentabilidad o predicciones de precios concretos
                ❌ Asesoramiento fiscal o legal
                ❌ Cualquier tema no financiero
            """


async def run_agent_stream(user_id, access_token, message, history, context=None, remember=False):
    _, df_movements_recent, df_portfolio = load_user_data(user_id, access_token)
    system_prompt = build_system_prompt(df_movements_recent)

    supabase = get_supabase_client(access_token)
    mem = load_memory(supabase, user_id)

    system_messages = [{"role": "system", "content": system_prompt}]
    block = memory_block(mem["facts"], mem["summary"])
    if block:
        system_messages.append({"role": "system", "content": block})
    if context:
        system_messages.append({
            "role": "system",
            "content": (
                "ESTADO DE PLANIFICACIÓN DE INVERSIÓN DEL USUARIO (fuente fiable, "
                "ya calculada por la app). Úsalo junto con tus tools. Sobre este "
                "estado SÍ puedes razonar de forma accionable (qué aportar este mes, "
                "qué señal se ha disparado, desviaciones), pero no inventes cifras "
                "que no estén aquí ni en tus datos:\n\n" + context
            ),
        })

    if remember:
        window = load_recent_messages(supabase, user_id, mem["summarized_until"])
        messages = window + [{"role": "user", "content": message}]
    else:
        messages = [{"role": m.role, "content": m.content} for m in history]
        messages.append({"role": "user", "content": message})

    full = ""
    for _ in range(5):
        response = await client.chat.completions.create(
            model=MODEL,
            messages=system_messages + messages,
            tools=TOOLS_SCHEMA,
            tool_choice="auto",
            temperature=0.1,
            max_completion_tokens=1024,
        )

        msg = response.choices[0].message

        if not msg.tool_calls:
            stream = await client.chat.completions.create(
                model=MODEL,
                messages=system_messages + messages,
                temperature=0.1,
                max_completion_tokens=1024,
                stream=True,
            )
            async for chunk in stream:
                token = chunk.choices[0].delta.content
                if token:
                    full += token
                    yield token
            if remember:
                save_turn(supabase, user_id, message, full)
                await maybe_compact(supabase, user_id, client, MODEL, mem)
            return

        messages.append(msg)
        for tool_call in msg.tool_calls:
            tool_name = tool_call.function.name
            tool_args = json.loads(tool_call.function.arguments)
            result = dispatch_tool(tool_name, tool_args, df_movements_recent, df_portfolio)
            messages.append({"role": "tool", "tool_call_id": tool_call.id, "content": result})

    yield "No se pudo resolver la consulta en el número máximo de iteraciones."