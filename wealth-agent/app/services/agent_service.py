import json
from openai import AsyncOpenAI
from app.config import OPENAI_API_KEY, MODEL
from app.tools.financial_tools import TOOLS_SCHEMA, dispatch_tool
from app.services.data_service import load_user_data

client = AsyncOpenAI(api_key=OPENAI_API_KEY)


def build_system_prompt(df_movements_recent):
    data_max_date = df_movements_recent["date"].max().strftime("%Y-%m-%d")
    data_current_month = df_movements_recent["date"].max().strftime("%Y-%m")
    return f"""Eres un asistente financiero personal especializado en análisis de gastos e inversiones.

                Tienes acceso a datos reales del usuario: movimientos bancarios y portfolio de inversión.

                CONTEXTO DE DATOS:
                - Fecha más reciente en los datos: {data_max_date}
                - Mes actual a efectos de análisis: {data_current_month}
                - Usa siempre este mes cuando el usuario diga "este mes" o "ahora"

                PRINCIPIOS:
                - Responde siempre en español
                - Sé conciso y directo, máximo 3-4 frases
                - Usa siempre los datos reales de las tools, nunca inventes cifras
                - Formatea cantidades siempre con € y dos decimales
                - Si la pregunta no está relacionada con finanzas personales, gastos o inversiones, responde ÚNICAMENTE con: "Lo siento, solo puedo ayudarte con consultas sobre tus finanzas personales."

                SCOPE:
                ✅ Gastos mensuales y por categoría
                ✅ Comparaciones entre meses
                ✅ Resumen de portfolio e inversiones
                ✅ Patrimonio neto y ahorro
                ✅ Tendencias de categorías

                ❌ Gráficos o visualizaciones
                ❌ Predicciones futuras
                ❌ Asesoramiento fiscal o legal
                ❌ Cualquier tema no financiero
            """


async def run_agent_stream(user_id, message, history, context=None):
    _, df_movements_recent, df_portfolio = load_user_data(user_id)
    system_prompt = build_system_prompt(df_movements_recent)

    system_messages = [{"role": "system", "content": system_prompt}]
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

    messages = [{"role": m.role, "content": m.content} for m in history]
    messages.append({"role": "user", "content": message})

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
                    yield token
            return

        messages.append(msg)
        for tool_call in msg.tool_calls:
            tool_name = tool_call.function.name
            tool_args = json.loads(tool_call.function.arguments)
            result = dispatch_tool(tool_name, tool_args, df_movements_recent, df_portfolio)
            messages.append({"role": "tool", "tool_call_id": tool_call.id, "content": result})

    yield "No se pudo resolver la consulta en el número máximo de iteraciones."