import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { pool } from "@/lib/db";
import { authenticateRequest } from "@/lib/auth";
import type { UserRow } from "@/lib/auth";
import { buildSystemPrompt, buildMessagesForApi } from "@/lib/prompt";
import type { ConversationMessage } from "@/lib/prompt";

export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (authResult instanceof Response) return authResult;

  const userId = authResult.sub;

  let body: { message?: string; conversationId?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(
      `data: ${JSON.stringify({ type: "error", error: "Solicitud inválida" })}\n\n`,
      { headers: { "Content-Type": "text/event-stream" } },
    );
  }

  const message = body.message?.trim();
  if (!message) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", error: "Mensaje requerido" })}\n\n`,
      { headers: { "Content-Type": "text/event-stream" } },
    );
  }

  // Get user name
  const userResult = await pool.query<UserRow>(
    "SELECT name FROM users WHERE id = $1",
    [userId],
  );
  const userName = userResult.rows[0]?.name ?? "sobrino";

  // Get or create conversation
  let conversation: {
    id: string;
    messages: ConversationMessage[];
  };

  if (body.conversationId) {
    const convResult = await pool.query(
      "SELECT id, messages FROM conversations WHERE id = $1 AND user_id = $2",
      [body.conversationId, userId],
    );
    if (convResult.rows.length > 0) {
      conversation = convResult.rows[0];
    } else {
      const newConv = await pool.query(
        `INSERT INTO conversations (user_id, messages, token_count)
         VALUES ($1, '[]', 0) RETURNING id, messages`,
        [userId],
      );
      conversation = newConv.rows[0];
    }
  } else {
    const convResult = await pool.query(
      `SELECT id, messages FROM conversations WHERE user_id = $1
       ORDER BY updated_at DESC LIMIT 1`,
      [userId],
    );
    if (convResult.rows.length > 0) {
      conversation = convResult.rows[0];
    } else {
      const newConv = await pool.query(
        `INSERT INTO conversations (user_id, messages, token_count)
         VALUES ($1, '[]', 0) RETURNING id, messages`,
        [userId],
      );
      conversation = newConv.rows[0];
    }
  }

  const history: ConversationMessage[] = conversation.messages ?? [];

  const userMsg: ConversationMessage = {
    role: "user",
    content: message,
    timestamp: new Date().toISOString(),
  };
  const updatedMessages = [...history, userMsg];

  const systemPrompt = buildSystemPrompt(userName);
  const apiMessages = buildMessagesForApi(history, message);

  // Stream response using ReadableStream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let fullResponse = "";

      try {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

        const anthropic = new Anthropic({ apiKey });
        const anthropicStream = anthropic.messages.stream({
          model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514",
          max_tokens: 1024,
          system: systemPrompt,
          messages: apiMessages,
        });

        anthropicStream.on("text", (text) => {
          fullResponse += text;
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "delta", text })}\n\n`,
            ),
          );
        });

        const finalMessage = await anthropicStream.finalMessage();

        // Save messages to conversation
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

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "done", conversationId: conversation.id })}\n\n`,
          ),
        );
      } catch (err) {
        console.error("Claude API error:", err);

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", error: "Lo siento, sobrino. Tuve un problema técnico. ¿Puedes intentar de nuevo en un momento?" })}\n\n`,
          ),
        );

        // Save user message even on error
        await pool.query(
          `UPDATE conversations
           SET messages = $1, updated_at = NOW()
           WHERE id = $2`,
          [JSON.stringify(updatedMessages), conversation.id],
        ).catch(() => {});
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
