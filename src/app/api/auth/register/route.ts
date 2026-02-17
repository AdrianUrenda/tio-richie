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
    const { email, name, password } = await request.json();

    if (!email || !name || !password) {
      return NextResponse.json(
        { error: "Email, nombre y contraseña son requeridos" },
        { status: 400 },
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "La contraseña debe tener al menos 8 caracteres" },
        { status: 400 },
      );
    }

    const existing = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email.toLowerCase().trim()],
    );

    if (existing.rows.length > 0) {
      return NextResponse.json(
        { error: "Este correo ya está registrado" },
        { status: 409 },
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query<UserRow>(
      `INSERT INTO users (email, name, password_hash)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [email.toLowerCase().trim(), name.trim(), passwordHash],
    );

    const user = result.rows[0];
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken();
    await storeRefreshToken(user.id, refreshToken);

    return NextResponse.json(
      { user: toUserPublic(user), accessToken, refreshToken },
      { status: 201 },
    );
  } catch (err) {
    console.error("Register error:", err);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 },
    );
  }
}
