import { Router, Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { pool } from "../db/index.js";
import { config } from "../config.js";
import { requireAuth } from "../middleware/auth.js";
import { buildSystemPrompt } from "../prompts/tio-richie.js";
import { buildFinancialSummary } from "../services/financial-engine.js";
import type { ConversationRow, ChatMessage } from "../types/index.js";

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
router.post("/message", requireAuth, async (req: Request, res: Response) => {
  const { conversationId, message } = req.body;

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    res.status(400).json({ error: "El mensaje no puede estar vacío" });
    return;
  }

  try {
    // Load or create conversation
    let convoId = conversationId;
    let messages: ChatMessage[] = [];

    if (convoId) {
      const result = await pool.query<ConversationRow>(
        "SELECT id, messages FROM conversations WHERE id = $1 AND user_id = $2",
        [convoId, req.user!.userId],
      );
      if (result.rows.length > 0) {
        messages = result.rows[0].messages;
      } else {
        convoId = null;
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
      system: buildSystemPrompt(userName, financialContext),
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

export default router;
