import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { pool } from "./db";

export interface JwtAccessPayload {
  sub: string;
  email: string;
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  subscription_status: string;
  trial_end_date: Date;
  notification_prefs: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface UserPublic {
  id: string;
  email: string;
  name: string;
  subscriptionStatus: string;
  trialEndDate: string;
  createdAt: string;
}

export function toUserPublic(row: UserRow): UserPublic {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    subscriptionStatus: row.subscription_status,
    trialEndDate: row.trial_end_date.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}

export function generateAccessToken(user: {
  id: string;
  email: string;
}): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error("JWT_ACCESS_SECRET not set");
  return jwt.sign({ sub: user.id, email: user.email }, secret, {
    expiresIn: "15m",
  });
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString("base64url");
}

export async function storeRefreshToken(
  userId: string,
  rawToken: string,
): Promise<void> {
  const tokenHash = crypto
    .createHash("sha256")
    .update(rawToken)
    .digest("hex");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt],
  );
}

export async function authenticateRequest(
  request: NextRequest,
): Promise<JwtAccessPayload | NextResponse> {
  const authHeader = request.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Token de acceso requerido" },
      { status: 401 },
    );
  }

  const token = authHeader.slice(7);
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error("JWT_ACCESS_SECRET not set");

  try {
    return jwt.verify(token, secret) as JwtAccessPayload;
  } catch {
    return NextResponse.json(
      { error: "Token inválido o expirado" },
      { status: 401 },
    );
  }
}
