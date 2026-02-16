import { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { pool } from "../db.js";
import { config } from "../config.js";
import { authenticate } from "../middleware/auth.js";
import type {
  RegisterBody,
  LoginBody,
  RefreshBody,
  UserRow,
  RefreshTokenRow,
  JwtAccessPayload,
  UserPublic,
} from "../types.js";

const BCRYPT_ROUNDS = 12;

function toUserPublic(row: UserRow): UserPublic {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    subscriptionStatus: row.subscription_status,
    trialEndDate: row.trial_end_date.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}

function generateAccessToken(user: { id: string; email: string }): string {
  const options: jwt.SignOptions = {
    expiresIn: config.jwt.accessExpiresIn as jwt.SignOptions["expiresIn"],
  };
  return jwt.sign(
    { sub: user.id, email: user.email } satisfies JwtAccessPayload,
    config.jwt.accessSecret,
    options,
  );
}

function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString("base64url");
}

async function storeRefreshToken(
  userId: string,
  rawToken: string,
): Promise<void> {
  const tokenHash = crypto
    .createHash("sha256")
    .update(rawToken)
    .digest("hex");

  const daysMatch = config.jwt.refreshExpiresIn.match(/^(\d+)d$/);
  const days = daysMatch ? parseInt(daysMatch[1], 10) : 30;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt],
  );
}

async function verifyRefreshToken(
  rawToken: string,
): Promise<RefreshTokenRow | null> {
  const tokenHash = crypto
    .createHash("sha256")
    .update(rawToken)
    .digest("hex");

  const result = await pool.query<RefreshTokenRow>(
    `SELECT * FROM refresh_tokens
     WHERE token_hash = $1 AND expires_at > NOW()`,
    [tokenHash],
  );

  return result.rows[0] ?? null;
}

async function deleteRefreshToken(tokenHash: string): Promise<void> {
  await pool.query("DELETE FROM refresh_tokens WHERE token_hash = $1", [
    tokenHash,
  ]);
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/auth/register
  app.post<{ Body: RegisterBody }>(
    "/api/auth/register",
    async (request, reply) => {
      const { email, name, password } = request.body;

      if (!email || !name || !password) {
        return reply
          .code(400)
          .send({ error: "Email, nombre y contraseña son requeridos" });
      }

      if (password.length < 8) {
        return reply
          .code(400)
          .send({ error: "La contraseña debe tener al menos 8 caracteres" });
      }

      const existing = await pool.query<UserRow>(
        "SELECT id FROM users WHERE email = $1",
        [email.toLowerCase().trim()],
      );

      if (existing.rows.length > 0) {
        return reply
          .code(409)
          .send({ error: "Este correo ya está registrado" });
      }

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

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

      return reply.code(201).send({
        user: toUserPublic(user),
        accessToken,
        refreshToken,
      });
    },
  );

  // POST /api/auth/login
  app.post<{ Body: LoginBody }>(
    "/api/auth/login",
    async (request, reply) => {
      const { email, password } = request.body;

      if (!email || !password) {
        return reply
          .code(400)
          .send({ error: "Email y contraseña son requeridos" });
      }

      const result = await pool.query<UserRow>(
        "SELECT * FROM users WHERE email = $1",
        [email.toLowerCase().trim()],
      );

      const user = result.rows[0];

      if (!user) {
        return reply.code(401).send({ error: "Credenciales inválidas" });
      }

      const valid = await bcrypt.compare(password, user.password_hash);

      if (!valid) {
        return reply.code(401).send({ error: "Credenciales inválidas" });
      }

      const accessToken = generateAccessToken(user);
      const refreshToken = generateRefreshToken();
      await storeRefreshToken(user.id, refreshToken);

      return reply.send({
        user: toUserPublic(user),
        accessToken,
        refreshToken,
      });
    },
  );

  // POST /api/auth/refresh
  app.post<{ Body: RefreshBody }>(
    "/api/auth/refresh",
    async (request, reply) => {
      const { refreshToken } = request.body;

      if (!refreshToken) {
        return reply
          .code(400)
          .send({ error: "Refresh token requerido" });
      }

      const stored = await verifyRefreshToken(refreshToken);

      if (!stored) {
        return reply
          .code(401)
          .send({ error: "Refresh token inválido o expirado" });
      }

      await deleteRefreshToken(stored.token_hash);

      const userResult = await pool.query<UserRow>(
        "SELECT * FROM users WHERE id = $1",
        [stored.user_id],
      );

      const user = userResult.rows[0];

      if (!user) {
        return reply.code(401).send({ error: "Usuario no encontrado" });
      }

      const newAccessToken = generateAccessToken(user);
      const newRefreshToken = generateRefreshToken();
      await storeRefreshToken(user.id, newRefreshToken);

      return reply.send({
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      });
    },
  );

  // GET /api/auth/me
  app.get(
    "/api/auth/me",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const result = await pool.query<UserRow>(
        "SELECT * FROM users WHERE id = $1",
        [request.user.sub],
      );

      const user = result.rows[0];

      if (!user) {
        return reply.code(404).send({ error: "Usuario no encontrado" });
      }

      return reply.send({ user: toUserPublic(user) });
    },
  );
}
