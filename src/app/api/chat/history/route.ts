import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { authenticateRequest } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (authResult instanceof NextResponse) return authResult;

    const userId = authResult.sub;

    let result = await pool.query(
      `SELECT * FROM conversations WHERE user_id = $1
       ORDER BY updated_at DESC LIMIT 1`,
      [userId],
    );

    if (result.rows.length === 0) {
      result = await pool.query(
        `INSERT INTO conversations (user_id, messages, token_count)
         VALUES ($1, $2, 0) RETURNING *`,
        [userId, JSON.stringify([])],
      );
    }

    const conversation = result.rows[0];

    return NextResponse.json({
      conversationId: conversation.id,
      messages: conversation.messages,
    });
  } catch (err) {
    console.error("Chat history error:", err);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 },
    );
  }
}
