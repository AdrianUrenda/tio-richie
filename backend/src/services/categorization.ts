// AI-powered transaction categorization using Claude
// Deterministic fallback for common patterns; LLM for ambiguous descriptions.

import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import type { CategoryResult, CsvTransactionInput } from "../types/index.js";

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

// Mexican transaction categories matching common bank statement patterns
const CATEGORIES = [
  "Alimentación",
  "Transporte",
  "Vivienda",
  "Servicios",
  "Salud",
  "Educación",
  "Entretenimiento",
  "Ropa y Accesorios",
  "Tecnología",
  "Finanzas",
  "Otros",
] as const;

// Rule-based categorization for common Mexican merchants/patterns
const KEYWORD_RULES: Array<{ pattern: RegExp; category: string; subcategory: string }> = [
  // Alimentación
  { pattern: /walmart|soriana|chedraui|la comer|heb|costco|sam'?s club|bodega aurrera/i, category: "Alimentación", subcategory: "Supermercado" },
  { pattern: /oxxo|7.?eleven|circle\s?k/i, category: "Alimentación", subcategory: "Tienda de conveniencia" },
  { pattern: /uber\s?eats|didi\s?food|rappi/i, category: "Alimentación", subcategory: "Delivery" },
  { pattern: /starbucks|italian coffee|cielito/i, category: "Alimentación", subcategory: "Café" },
  { pattern: /restauran|taquer|fonda|comida|sushi|pizza|burger|pollo/i, category: "Alimentación", subcategory: "Restaurante" },
  // Transporte
  { pattern: /uber(?!\s?eat)|didi(?!\s?food)|cabify|beat/i, category: "Transporte", subcategory: "Taxi/App" },
  { pattern: /gasolina|pemex|bp\s|shell|mobil/i, category: "Transporte", subcategory: "Gasolina" },
  { pattern: /estacionamiento|parking/i, category: "Transporte", subcategory: "Estacionamiento" },
  { pattern: /caseta|tag|televia|pase/i, category: "Transporte", subcategory: "Casetas" },
  // Vivienda
  { pattern: /renta|alquiler|arrendamiento/i, category: "Vivienda", subcategory: "Renta" },
  { pattern: /hipoteca|cr[eé]dito\s?hipotecario/i, category: "Vivienda", subcategory: "Hipoteca" },
  { pattern: /mantenimiento|condominio/i, category: "Vivienda", subcategory: "Mantenimiento" },
  // Servicios
  { pattern: /cfe|comisi[oó]n federal|luz/i, category: "Servicios", subcategory: "Electricidad" },
  { pattern: /telmex|izzi|totalplay|megacable|axtel/i, category: "Servicios", subcategory: "Internet/Teléfono" },
  { pattern: /telcel|at&t|movistar|altan/i, category: "Servicios", subcategory: "Celular" },
  { pattern: /agua|sapas|siapa|sapal/i, category: "Servicios", subcategory: "Agua" },
  { pattern: /gas natural|naturgy/i, category: "Servicios", subcategory: "Gas" },
  { pattern: /netflix|spotify|disney|hbo|prime\s?video|youtube|apple\s?(tv|music)/i, category: "Servicios", subcategory: "Streaming" },
  // Salud
  { pattern: /farmacia|benavides|guadalajara|del ahorro|san pablo/i, category: "Salud", subcategory: "Farmacia" },
  { pattern: /doctor|hospital|cl[ií]nica|laboratorio|consulta m[eé]dica/i, category: "Salud", subcategory: "Médico" },
  { pattern: /seguro\s?(m[eé]dico|gastos|vida)/i, category: "Salud", subcategory: "Seguro" },
  // Entretenimiento
  { pattern: /cinepolis|cinemex|cine/i, category: "Entretenimiento", subcategory: "Cine" },
  { pattern: /spotify|apple\s?music/i, category: "Entretenimiento", subcategory: "Música" },
  { pattern: /gym|gimnasio|sport\s?city|smart\s?fit/i, category: "Entretenimiento", subcategory: "Gimnasio" },
  // Finanzas
  { pattern: /comisi[oó]n|anualidad|inter[eé]s|cargo\s?(bancario|por)/i, category: "Finanzas", subcategory: "Comisiones bancarias" },
  { pattern: /transferencia|spei|traspaso/i, category: "Finanzas", subcategory: "Transferencia" },
  { pattern: /retiro|atm|cajero/i, category: "Finanzas", subcategory: "Retiro efectivo" },
  // Income patterns
  { pattern: /n[oó]mina|salario|sueldo|pago\s?de\s?n[oó]mina/i, category: "Ingreso", subcategory: "Nómina" },
  { pattern: /dep[oó]sito|abono/i, category: "Ingreso", subcategory: "Depósito" },
  { pattern: /aguinaldo/i, category: "Ingreso", subcategory: "Aguinaldo" },
  { pattern: /reembolso|devoluci[oó]n/i, category: "Ingreso", subcategory: "Reembolso" },
];

// Patterns indicating recurring transactions
const RECURRING_PATTERNS = [
  /n[oó]mina|salario|sueldo/i,
  /renta|alquiler|arrendamiento|hipoteca/i,
  /netflix|spotify|disney|hbo|prime|youtube|apple/i,
  /telmex|izzi|totalplay|megacable|telcel|at&t/i,
  /cfe|luz|agua|gas\s?natural/i,
  /seguro/i,
  /gym|gimnasio|sport\s?city|smart\s?fit/i,
  /mantenimiento|condominio/i,
];

// Income detection patterns
const INCOME_PATTERNS = [
  /n[oó]mina|salario|sueldo/i,
  /dep[oó]sito/i,
  /abono/i,
  /aguinaldo/i,
  /reembolso|devoluci[oó]n/i,
  /bono|comisi[oó]n\s?(ganada|cobrada)/i,
  /honorarios|freelance/i,
  /renta\s?(cobrada|recibida)/i,
  /dividendo/i,
  /inter[eé]s\s?(ganado|cobrado|a\s?favor)/i,
];

/**
 * Categorize a single transaction — tries rules first, falls back to LLM.
 */
export function categorizeByRules(description: string, amount: number): CategoryResult | null {
  const isPositive = amount > 0;

  // Check income patterns for positive amounts
  if (isPositive) {
    for (const rule of KEYWORD_RULES) {
      if (rule.pattern.test(description) && rule.category === "Ingreso") {
        return {
          category: rule.category,
          subcategory: rule.subcategory,
          isRecurring: RECURRING_PATTERNS.some((p) => p.test(description)),
          isIncome: true,
        };
      }
    }
    // Positive amount without matching rule — default to income
    return {
      category: "Ingreso",
      subcategory: "Depósito",
      isRecurring: RECURRING_PATTERNS.some((p) => p.test(description)),
      isIncome: true,
    };
  }

  // Expense matching
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(description) && rule.category !== "Ingreso") {
      return {
        category: rule.category,
        subcategory: rule.subcategory,
        isRecurring: RECURRING_PATTERNS.some((p) => p.test(description)),
        isIncome: false,
      };
    }
  }

  return null; // No match — needs LLM
}

/**
 * Detect if a transaction is income based on amount sign and description.
 */
export function detectIncome(description: string, amount: number): boolean {
  if (amount > 0) return true;
  return INCOME_PATTERNS.some((p) => p.test(description));
}

/**
 * Batch-categorize transactions using Claude when rules don't match.
 * Batches up to 50 transactions per LLM call for efficiency.
 */
export async function categorizeWithAI(
  transactions: Array<{ description: string; amount: number; index: number }>,
): Promise<Map<number, CategoryResult>> {
  const results = new Map<number, CategoryResult>();

  if (transactions.length === 0) return results;

  const BATCH_SIZE = 50;
  for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
    const batch = transactions.slice(i, i + BATCH_SIZE);

    const prompt = `Clasifica estas transacciones bancarias mexicanas. Para cada una, responde SOLO con JSON.

Categorías válidas: ${CATEGORIES.join(", ")}, Ingreso
Cada transacción tiene: índice, descripción, monto (negativo = gasto, positivo = ingreso).

Transacciones:
${batch.map((t) => `[${t.index}] "${t.description}" $${t.amount}`).join("\n")}

Responde SOLO con un arreglo JSON, sin texto adicional:
[{"i": <índice>, "cat": "<categoría>", "sub": "<subcategoría>", "rec": <true/false si es recurrente>}]`;

    try {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      });

      const text = response.content[0].type === "text" ? response.content[0].text : "";
      // Extract JSON array from response (may be wrapped in markdown code block)
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Array<{
          i: number;
          cat: string;
          sub: string;
          rec: boolean;
        }>;
        for (const item of parsed) {
          results.set(item.i, {
            category: item.cat,
            subcategory: item.sub,
            isRecurring: item.rec,
            isIncome: item.cat === "Ingreso",
          });
        }
      }
    } catch (err) {
      console.error("AI categorization error:", err);
      // Fall back to "Otros" for failed batch
      for (const t of batch) {
        results.set(t.index, {
          category: t.amount > 0 ? "Ingreso" : "Otros",
          subcategory: t.amount > 0 ? "Depósito" : "Sin clasificar",
          isRecurring: false,
          isIncome: t.amount > 0,
        });
      }
    }
  }

  return results;
}

/**
 * Categorize a full array of transactions — rules first, LLM for the rest.
 */
export async function categorizeTransactions(
  transactions: CsvTransactionInput[],
): Promise<CategoryResult[]> {
  const results: CategoryResult[] = new Array(transactions.length);
  const needsAI: Array<{ description: string; amount: number; index: number }> = [];

  // First pass: apply rules
  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    const result = categorizeByRules(tx.description, tx.amount);
    if (result) {
      results[i] = result;
    } else {
      needsAI.push({ description: tx.description, amount: tx.amount, index: i });
    }
  }

  // Second pass: LLM for unmatched
  if (needsAI.length > 0) {
    const aiResults = await categorizeWithAI(needsAI);
    for (const [index, result] of aiResults) {
      results[index] = result;
    }
  }

  // Safety net: fill any remaining gaps
  for (let i = 0; i < results.length; i++) {
    if (!results[i]) {
      const amount = transactions[i].amount;
      results[i] = {
        category: amount > 0 ? "Ingreso" : "Otros",
        subcategory: amount > 0 ? "Depósito" : "Sin clasificar",
        isRecurring: false,
        isIncome: amount > 0,
      };
    }
  }

  return results;
}
