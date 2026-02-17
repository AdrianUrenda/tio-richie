import { FastifyInstance } from "fastify";
import Anthropic from "@anthropic-ai/sdk";
import { pool } from "../db.js";
import { config } from "../config.js";
import { authenticate } from "../middleware/auth.js";
import { buildSystemPrompt, buildMessagesForApi } from "../prompt.js";
import type {
  ChatMessageBody,
  ConversationRow,
  ConversationMessage,
  UserRow,
} from "../types.js";

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/chat/history — load or create conversation
  app.get(
    "/api/chat/history",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const userId = request.user.sub;

      // Get or create conversation for this user
      let result = await pool.query<ConversationRow>(
        `SELECT * FROM conversations WHERE user_id = $1
         ORDER BY updated_at DESC LIMIT 1`,
        [userId],
      );

      if (result.rows.length === 0) {
        // Create a new conversation
        result = await pool.query<ConversationRow>(
          `INSERT INTO conversations (user_id, messages, token_count)
           VALUES ($1, $2, 0) RETURNING *`,
          [userId, JSON.stringify([])],
        );
      }

      const conversation = result.rows[0];

      return reply.send({
        conversationId: conversation.id,
        messages: conversation.messages,
      });
    },
  );

  // POST /api/chat/message — send message, stream Claude response
  app.post<{ Body: ChatMessageBody }>(
    "/api/chat/message",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const userId = request.user.sub;
      const { message, conversationId } = request.body;

      if (!message?.trim()) {
        return reply.code(400).send({ error: "Mensaje requerido" });
      }

      // Get user name for persona
      const userResult = await pool.query<UserRow>(
        "SELECT name FROM users WHERE id = $1",
        [userId],
      );
      const userName = userResult.rows[0]?.name ?? "sobrino";

      // Get or create conversation
      let convResult: { rows: ConversationRow[] };

      if (conversationId) {
        convResult = await pool.query<ConversationRow>(
          "SELECT * FROM conversations WHERE id = $1 AND user_id = $2",
          [conversationId, userId],
        );
      } else {
        convResult = await pool.query<ConversationRow>(
          `SELECT * FROM conversations WHERE user_id = $1
           ORDER BY updated_at DESC LIMIT 1`,
          [userId],
        );
      }

      let conversation: ConversationRow;

      if (convResult.rows.length === 0) {
        const newConv = await pool.query<ConversationRow>(
          `INSERT INTO conversations (user_id, messages, token_count)
           VALUES ($1, $2, 0) RETURNING *`,
          [userId, JSON.stringify([])],
        );
        conversation = newConv.rows[0];
      } else {
        conversation = convResult.rows[0];
      }

      const history: ConversationMessage[] = conversation.messages ?? [];

      // Add user message to history
      const userMsg: ConversationMessage = {
        role: "user",
        content: message.trim(),
        timestamp: new Date().toISOString(),
      };

      const updatedMessages = [...history, userMsg];

      // Build API request
      const systemPrompt = buildSystemPrompt(userName);
      const apiMessages = buildMessagesForApi(history, message.trim());

      // Set up SSE streaming
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      let fullResponse = "";

      try {
        const stream = anthropic.messages.stream({
          model: config.anthropic.model,
          max_tokens: 1024,
          system: systemPrompt,
          messages: apiMessages,
        });

        stream.on("text", (text) => {
          fullResponse += text;
          reply.raw.write(`data: ${JSON.stringify({ type: "delta", text })}\n\n`);
        });

        const finalMessage = await stream.finalMessage();

        // Save both messages to conversation
        const assistantMsg: ConversationMessage = {
          role: "assistant",
          content: fullResponse,
          timestamp: new Date().toISOString(),
        };

        const finalMessages = [...updatedMessages, assistantMsg];
        const tokenCount =
          (finalMessage.usage?.input_tokens ?? 0) +
          (finalMessage.usage?.output_tokens ?? 0);

        await pool.query(
          `UPDATE conversations
           SET messages = $1, token_count = token_count + $2, updated_at = NOW()
           WHERE id = $3`,
          [JSON.stringify(finalMessages), tokenCount, conversation.id],
        );

        reply.raw.write(
          `data: ${JSON.stringify({ type: "done", conversationId: conversation.id })}\n\n`,
        );
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Error desconocido";
        console.error("Claude API error:", errorMessage);

        reply.raw.write(
          `data: ${JSON.stringify({ type: "error", error: "Lo siento, sobrino. Tuve un problema técnico. ¿Puedes intentar de nuevo en un momento?" })}\n\n`,
        );

        // Still save the user message even if Claude fails
        await pool.query(
          `UPDATE conversations
           SET messages = $1, updated_at = NOW()
           WHERE id = $2`,
          [JSON.stringify(updatedMessages), conversation.id],
        );
      }

      reply.raw.end();
    },
  );

  // GET /api/chat/safe-to-spend — returns safe-to-spend amount
  app.get(
    "/api/chat/safe-to-spend",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const userId = request.user.sub;

      // Check if user has any accounts with financial data
      const accountsResult = await pool.query(
        "SELECT COUNT(*) as count FROM accounts WHERE user_id = $1",
        [userId],
      );

      const hasData = parseInt(accountsResult.rows[0].count, 10) > 0;

      if (!hasData) {
        return reply.send({
          amount: null,
          label: "Conecta tu banco para ver cuánto puedes gastar hoy",
          hasFinancialData: false,
        });
      }

      // TODO: Implement real safe-to-spend calculation
      // Formula: (remaining income for period - committed expenses - goal contributions) / remaining days
      // For now, return placeholder based on account balances
      const balanceResult = await pool.query(
        `SELECT COALESCE(SUM(balance), 0) as total
         FROM accounts WHERE user_id = $1 AND account_type IN ('checking', 'savings')`,
        [userId],
      );

      const totalBalance = parseFloat(balanceResult.rows[0].total);

      // Simple placeholder: total balance / remaining days in month
      const today = new Date();
      const daysInMonth = new Date(
        today.getFullYear(),
        today.getMonth() + 1,
        0,
      ).getDate();
      const remainingDays = daysInMonth - today.getDate() + 1;
      const safeToSpend = Math.round((totalBalance / remainingDays) * 100) / 100;

      return reply.send({
        amount: safeToSpend,
        label: `Hoy puedes gastar: $${safeToSpend.toLocaleString("es-MX")} MXN`,
        hasFinancialData: true,
      });
    },
  );
}
