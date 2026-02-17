import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { authenticateRequest, toUserPublic } from "@/lib/auth";
import type { UserRow } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (authResult instanceof NextResponse) return authResult;

    const result = await pool.query<UserRow>(
      "SELECT * FROM users WHERE id = $1",
      [authResult.sub],
    );

    const user = result.rows[0];

    if (!user) {
      return NextResponse.json(
        { error: "Usuario no encontrado" },
        { status: 404 },
      );
    }

    return NextResponse.json({ user: toUserPublic(user) });
  } catch (err) {
    console.error("Me error:", err);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 },
    );
  }
}
