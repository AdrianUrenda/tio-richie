import { Router, Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { pool } from "../db/index.js";
import { config } from "../config.js";
import { requireAuth } from "../middleware/auth.js";
import { buildSystemPrompt } from "../prompts/tio-richie.js";
import { buildFinancialSummary } from "../services/financial-engine.js";
import { markNotificationOpened } from "../services/push-notification.js";
import type { ConversationRow, ChatMessage, GoalRow } from "../types/index.js";

const router = Router();

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

// GET /api/chat/conversations — get or create the user's active conversation
router.get("/conversations", requireAuth, async (req, res) => {
  try {
    let result = await pool.query<ConversationRow>(
      "SELECT id, messages, created_at, updated_at FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1",
      [req.user!.userId],
    );

    if (result.rows.length === 0) {
      result = await pool.query<ConversationRow>(
        "INSERT INTO conversations (user_id, messages) VALUES ($1, '[]') RETURNING id, messages, created_at, updated_at",
        [req.user!.userId],
      );
    }

    const convo = result.rows[0];
    res.json({ conversation: { id: convo.id, messages: convo.messages } });
  } catch (err) {
    console.error("Fetch conversation error:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// POST /api/chat/message — send a message, stream back Claude's response
// Accepts optional context from notification tap (PRD 7.3)
router.post("/message", requireAuth, async (req: Request, res: Response) => {
  const { conversationId, message, context } = req.body as {
    conversationId?: string;
    message: string;
    context?: { type: string; notificationId?: string; category?: string; percent?: number; goalId?: string };
  };

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    res.status(400).json({ error: "El mensaje no puede estar vacío" });
    return;
  }

  try {
    // Mark notification as opened if coming from a push notification
    if (context?.notificationId) {
      await markNotificationOpened(context.notificationId, req.user!.userId).catch(() => {});
    }

    // Load or create conversation
    let convoId: string | undefined = conversationId;
    let messages: ChatMessage[] = [];

    if (convoId) {
      const result = await pool.query<ConversationRow>(
        "SELECT id, messages FROM conversations WHERE id = $1 AND user_id = $2",
        [convoId, req.user!.userId],
      );
      if (result.rows.length > 0) {
        messages = result.rows[0].messages;
      } else {
        convoId = undefined;
      }
    }

    if (!convoId) {
      const result = await pool.query<ConversationRow>(
        "INSERT INTO conversations (user_id, messages) VALUES ($1, '[]') RETURNING id, messages",
        [req.user!.userId],
      );
      convoId = result.rows[0].id;
      messages = [];
    }

    // Add user message
    const userMessage: ChatMessage = {
      role: "user",
      content: message.trim(),
      timestamp: new Date().toISOString(),
    };
    messages.push(userMessage);

    // Get user name for persona
    const userResult = await pool.query<{ name: string }>(
      "SELECT name FROM users WHERE id = $1",
      [req.user!.userId],
    );
    const userName = userResult.rows[0]?.name || "sobrino";

    // Build financial context from the financial engine
    const financialContext = await buildFinancialSummary(req.user!.userId);

    // Build notification context if the message comes from a notification tap (PRD 7.3)
    let notificationContext: string | undefined;
    if (context?.type) {
      notificationContext = await buildNotificationContext(req.user!.userId, context);
    }

    // Prepare messages for Claude — last 20 messages per PRD spec
    const recentMessages = messages.slice(-20).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Conversation-Id", convoId);
    res.flushHeaders();

    // Stream from Claude
    let assistantContent = "";

    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1024,
      system: buildSystemPrompt(userName, financialContext, notificationContext),
      messages: recentMessages,
    });

    stream.on("text", (text) => {
      assistantContent += text;
      res.write(`data: ${JSON.stringify({ type: "text", content: text })}\n\n`);
    });

    stream.on("error", (err) => {
      console.error("Claude stream error:", err);
      res.write(`data: ${JSON.stringify({ type: "error", content: "Error al generar respuesta" })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    });

    stream.on("end", async () => {
      // Save assistant message to conversation
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: assistantContent,
        timestamp: new Date().toISOString(),
      };
      messages.push(assistantMessage);

      try {
        await pool.query(
          "UPDATE conversations SET messages = $1, token_count = token_count + $2 WHERE id = $3",
          [JSON.stringify(messages), assistantContent.length, convoId],
        );
      } catch (dbErr) {
        console.error("Failed to save conversation:", dbErr);
      }

      res.write(`data: ${JSON.stringify({ type: "done", conversationId: convoId })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    });
  } catch (err) {
    console.error("Chat message error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Error interno del servidor" });
    } else {
      res.write(`data: ${JSON.stringify({ type: "error", content: "Error interno" })}\n\n`);
      res.end();
    }
  }
});

// --- Build notification context for system prompt enrichment (PRD 7.3) ---

async function buildNotificationContext(
  userId: string,
  context: { type: string; category?: string; percent?: number; goalId?: string },
): Promise<string> {
  const parts: string[] = [];

  if (context.type === "spending_alert" && context.category) {
    // Fetch budget details for the category
    const budgetResult = await pool.query<{ categories: Array<{ name: string; limit: number }> }>(
      "SELECT categories FROM budgets WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1",
      [userId],
    );
    const categories = budgetResult.rows[0]?.categories || [];
    const catBudget = categories.find((c) => c.name === context.category);

    // Fetch actual spending
    const { getCurrentQuincena, formatDateForDb } = await import("../services/financial-engine.js");
    const period = getCurrentQuincena();
    const spentResult = await pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(ABS(amount)), 0) as total
       FROM transactions WHERE user_id = $1 AND category = $2 AND amount < 0
       AND date >= $3 AND date <= $4`,
      [userId, context.category, formatDateForDb(period.start), formatDateForDb(period.end)],
    );
    const spent = Number(spentResult.rows[0].total);

    parts.push(`ALERTA DE GASTO: El usuario ha gastado $${spent.toLocaleString("es-MX")} en ${context.category} esta quincena.`);
    if (catBudget) {
      parts.push(`Presupuesto para ${context.category}: $${catBudget.limit.toLocaleString("es-MX")}. Porcentaje usado: ${context.percent || Math.round((spent / catBudget.limit) * 100)}%.`);
    }
    parts.push("El usuario necesita coaching sobre cómo ajustar su gasto en esta categoría o redistribuir su presupuesto.");
  }

  if (context.type === "debt_payment_reminder" && context.goalId) {
    const goalResult = await pool.query<GoalRow>(
      "SELECT * FROM goals WHERE id = $1 AND user_id = $2 AND type = 'debt_payoff'",
      [context.goalId, userId],
    );
    if (goalResult.rows.length > 0) {
      const goal = goalResult.rows[0];
      const balance = Number(goal.current_balance);
      const minPay = Number(goal.minimum_payment);
      const rate = Number(goal.interest_rate) * 100;
      parts.push(`RECORDATORIO DE PAGO: Deuda con saldo de $${balance.toLocaleString("es-MX")}, tasa ${rate.toFixed(1)}% anual.`);
      parts.push(`Pago mínimo: $${minPay.toLocaleString("es-MX")}. Día de vencimiento: ${goal.payment_due_day}.`);
      if (goal.strategy) {
        parts.push(`Estrategia activa: ${goal.strategy}.`);
      }
      parts.push("Anima al usuario a pagar más del mínimo si es posible y muéstrale el impacto en su plan de pago.");
    }
  }

  if (context.type === "quincena_checkin") {
    parts.push("CHECK-IN DE QUINCENA: El usuario acaba de recibir su quincena y quiere revisar su plan financiero.");
    parts.push("Haz un resumen de cómo le fue la quincena pasada y ayúdalo a planear los próximos 15 días.");
  }

  return parts.join("\n");
}

export default router;
