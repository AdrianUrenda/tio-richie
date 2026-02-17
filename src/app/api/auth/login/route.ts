import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { pool } from "@/lib/db";
import {
  generateAccessToken,
  generateRefreshToken,
  storeRefreshToken,
  toUserPublic,
} from "@/lib/auth";
import type { UserRow } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email y contraseña son requeridos" },
        { status: 400 },
      );
    }

    const result = await pool.query<UserRow>(
      "SELECT * FROM users WHERE email = $1",
      [email.toLowerCase().trim()],
    );

    const user = result.rows[0];

    if (!user) {
      return NextResponse.json(
        { error: "Credenciales inválidas" },
        { status: 401 },
      );
    }

    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      return NextResponse.json(
        { error: "Credenciales inválidas" },
        { status: 401 },
      );
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken();
    await storeRefreshToken(user.id, refreshToken);

    return NextResponse.json({
      user: toUserPublic(user),
      accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error("Login error:", err);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 },
    );
  }
}
