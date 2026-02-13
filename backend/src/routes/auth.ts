import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "../db/index.js";
import { config } from "../config.js";
import { requireAuth } from "../middleware/auth.js";
import type { UserRow, JwtPayload } from "../types/index.js";

const router = Router();

function signToken(user: Pick<UserRow, "id" | "email">): string {
  const payload: JwtPayload = { userId: user.id, email: user.email };
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

// POST /api/auth/register
router.post("/register", async (req, res) => {
  const { email, name, password } = req.body;

  if (!email || !name || !password) {
    res.status(400).json({ error: "Email, nombre y contraseña son requeridos" });
    return;
  }
  if (typeof password !== "string" || password.length < 8) {
    res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres" });
    return;
  }

  try {
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      res.status(409).json({ error: "Ya existe una cuenta con ese correo" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 30);

    const result = await pool.query<UserRow>(
      `INSERT INTO users (email, name, password_hash, subscription_status, trial_end_date)
       VALUES ($1, $2, $3, 'trial', $4)
       RETURNING id, email, name, subscription_status, trial_end_date, created_at`,
      [email, name, passwordHash, trialEnd.toISOString()],
    );

    const user = result.rows[0];
    const token = signToken(user);

    res.status(201).json({ token, user });
  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: "Email y contraseña son requeridos" });
    return;
  }

  try {
    const result = await pool.query<UserRow>("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length === 0) {
      res.status(401).json({ error: "Credenciales incorrectas" });
      return;
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: "Credenciales incorrectas" });
      return;
    }

    const token = signToken(user);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        subscription_status: user.subscription_status,
        trial_end_date: user.trial_end_date,
        created_at: user.created_at,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// GET /api/auth/me
router.get("/me", requireAuth, async (req, res) => {
  try {
    const result = await pool.query<UserRow>(
      "SELECT id, email, name, subscription_status, trial_end_date, created_at FROM users WHERE id = $1",
      [req.user!.userId],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error("Fetch user error:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

export default router;
