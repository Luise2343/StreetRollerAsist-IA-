import OpenAI from "openai";
import fs from "fs";
import path from "path";
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

export const SYSTEM = fs.readFileSync(
  path.resolve(process.cwd(), "StreetRollerAsist-IA-/src/policy/prompts/prompts"),
  "utf8"
);
const SLOTS_SCHEMA_PATH = path.resolve(process.cwd(), "src/policy/slots.schema.json");
let SLOTS_SCHEMA = null;
try {
  const raw = fs.readFileSync(SLOTS_SCHEMA_PATH, "utf8");
  SLOTS_SCHEMA = JSON.parse(raw);
  console.log("Slots schema cargado ✅", SLOTS_SCHEMA?.version || "");
} catch (e) {
  console.warn("Slots schema no encontrado o inválido. Ruta esperada:", SLOTS_SCHEMA_PATH);
}

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

export async function aiReplyStrict(userText, ctx) {
  if (!openai) return null;

  const messages = [{ role: "system", content: SYSTEM }];

  if (SLOTS_SCHEMA) {
    messages.push({
      role: "system",
      content: `POLÍTICA DE SLOTS (JSON). Usa estos cascarones/slots por categoría para decidir si haces NBQ o consultas DB:\n${JSON.stringify(SLOTS_SCHEMA)}`
    });
  }

  if (ctx?.last_frame) {
    messages.push({
      role: "system",
      content: `Estado previo del usuario (last_frame): ${JSON.stringify(ctx.last_frame)}`
    });
  }

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

  messages.push({ role: "user", content: String(userText || "").slice(0, 800) });

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
            size:  { type: "string", description: "Talla solicitada (ej: '6', '7', '10')" }
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
    const r = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      tools,
      tool_choice: "auto"
    });

    const choice = r.choices?.[0]?.message;

    if (choice?.tool_calls?.[0]) {
      const call = choice.tool_calls[0];

      if (call.function.name === "searchProducts") {
        const args = JSON.parse(call.function.arguments || "{}");

        let size = args.size || null;
        if (size != null) {
          size = String(size).replace(/[^\d]/g, "");
          if (!size) size = null;
        }

        const products = await searchProducts({
          text: args.query || "",
          size
        });

        return await answerWithProducts(messages, choice, call, products);
      }

      if (call.function.name === "listAllProducts") {
        const products = await listAllProducts();
        return await answerWithProducts(messages, choice, call, products);
      }
    }

    return choice?.content?.trim() || null;
  } catch (e) {
    console.error("OpenAI error:", e?.status, e?.code || e?.message);
    return null;
  }
}
