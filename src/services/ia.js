// src/services/ia.js
import OpenAI from "openai";
import { searchProducts, listAllProducts } from "./products.search.js";

const OPENAI_ENABLED = (process.env.OPENAI_ENABLED ?? "true") !== "false";
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const MAX_OUT = Math.max(
  1,
  parseInt(String(process.env.AI_MAX_OUTPUT_TOKENS ?? "120").trim(), 10) || 120
);
const LANG = process.env.AI_LANG ?? "es";

let openai = null;
if (OPENAI_ENABLED && process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export const SYSTEM = `
Eres un asistente de ventas para una tienda de patines.
Tu comportamiento es el siguiente:

1. Siempre que el cliente pregunte por productos, tallas o colores:
   - Llama a la función SEARCH_PRODUCTS con el texto y/o talla que detectes en el mensaje.
   - Nunca digas que "no hay stock" sin haber consultado la base de datos.

2. Si SEARCH_PRODUCTS no devuelve resultados:
   - Responde claramente: "No encontré patines en talla/color <X>. 
     Pero puedo mostrarte otras opciones."

3. Cuando muestres productos:
   - Muestra un máximo de 5 opciones.
   - Usa viñetas o enumeración simple.
   - Incluye nombre, talla, precio .
   

4. Si hay más productos de los mostrados:
   - Añade al final: "Hay más modelos disponibles, ¿quieres que te los muestre?"
   
5. Tu tono debe ser natural y amigable, como un vendedor que ayuda a elegir.
`;

/**
 * Helper para responder con productos desde un tool call
 */
async function answerWithProducts(messages, choice, call, products) {
  const r2 = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      ...messages,
      choice,
      {
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(products)
      }
    ],
    max_tokens: MAX_OUT
  });

  return r2.choices?.[0]?.message?.content?.trim() || null;
}

/**
 * userText: mensaje del usuario
 * ctx: { summary?: string, turns?: Array, profileFacts?: object }
 */
export async function aiReplyStrict(userText, ctx) {
  if (!openai) return null;

  const messages = [{ role: "system", content: SYSTEM }];

  // Resumen persistente si existe
  if (ctx?.summary) {
    messages.push({
      role: "system",
      content: `Resumen previo de la conversación:\n${String(ctx.summary).slice(0, 1500)}`
    });
  }

  // Datos persistentes del cliente
  if (ctx?.profileFacts && Object.keys(ctx.profileFacts).length) {
    const pf = JSON.stringify(ctx.profileFacts);
    messages.push({
      role: "system",
      content: `Datos persistentes del cliente (pueden estar desactualizados): ${pf}`
    });
  }

  // Turnos previos
  for (const t of ctx?.turns ?? []) {
    const u = (t?.user ?? "").trim();
    const a = (t?.assistant ?? "").trim();
    if (u) messages.push({ role: "user", content: u });
    if (a) messages.push({ role: "assistant", content: a });
  }

  // Mensaje actual
  messages.push({ role: "user", content: String(userText || "").slice(0, 800) });

  // Definición de tools
  const tools = [
    {
      type: "function",
      function: {
        name: "searchProducts",
        description: "Buscar productos por texto (ej: color, talla, modelo)",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Palabras clave (ej: 'patines rojos')" },
            size: { type: "string", description: "Talla solicitada (ej: '6', '7', '10')" }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "listAllProducts",
        description: "Listar todos los productos activos, con tallas y colores disponibles",
        parameters: { type: "object", properties: {} }
      }
    }
  ];

  try {
    // Primer paso: IA analiza y decide si necesita llamar a un tool
    const r = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      tools,
      tool_choice: "auto"
    });

    const choice = r.choices?.[0]?.message;

    // 👉 Si la IA pidió usar una función
    if (choice?.tool_calls?.[0]) {
      const call = choice.tool_calls[0];

      if (call.function.name === "searchProducts") {
        const args = JSON.parse(call.function.arguments || "{}");

        const products = await searchProducts({
          text: args.query || "",
          size: args.size || null
        });

        return await answerWithProducts(messages, choice, call, products);
      }

      if (call.function.name === "listAllProducts") {
        const products = await listAllProducts();
        return await answerWithProducts(messages, choice, call, products);
      }
    }

    // 👉 Si la IA no pidió función, devolver respuesta normal
    return choice?.content?.trim() || null;
  } catch (e) {
    console.error("OpenAI error:", e?.status, e?.code || e?.message);
    return null;
  }
}
