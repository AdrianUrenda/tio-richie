import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { pool } from "@/lib/db";
import {
  generateAccessToken,
  generateRefreshToken,
  storeRefreshToken,
} from "@/lib/auth";
import type { UserRow } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const { refreshToken } = await request.json();

    if (!refreshToken) {
      return NextResponse.json(
        { error: "Refresh token requerido" },
        { status: 400 },
      );
    }

    const tokenHash = crypto
      .createHash("sha256")
      .update(refreshToken)
      .digest("hex");

    const stored = await pool.query(
      `SELECT * FROM refresh_tokens
       WHERE token_hash = $1 AND expires_at > NOW()`,
      [tokenHash],
    );

    if (stored.rows.length === 0) {
      return NextResponse.json(
        { error: "Refresh token inválido o expirado" },
        { status: 401 },
      );
    }

    const storedToken = stored.rows[0];

    // Delete used token (rotation)
    await pool.query("DELETE FROM refresh_tokens WHERE token_hash = $1", [
      tokenHash,
    ]);

    const userResult = await pool.query<UserRow>(
      "SELECT * FROM users WHERE id = $1",
      [storedToken.user_id],
    );

    const user = userResult.rows[0];

    if (!user) {
      return NextResponse.json(
        { error: "Usuario no encontrado" },
        { status: 401 },
      );
    }

    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken();
    await storeRefreshToken(user.id, newRefreshToken);

    return NextResponse.json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch (err) {
    console.error("Refresh error:", err);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 },
    );
  }
}
