// Notification routes — push subscription management, notification listing, preferences
// FR-500, FR-507

import { Router } from "express";
import { pool } from "../db/index.js";
import { config } from "../config.js";
import { requireAuth } from "../middleware/auth.js";
import { markNotificationOpened } from "../services/push-notification.js";
import type { PushSubscriptionRow, NotificationRow } from "../types/index.js";

const router = Router();

// GET /api/notifications/vapid-public-key — return VAPID public key for frontend (unauthenticated)
router.get("/vapid-public-key", (_req, res) => {
  res.json({ vapidPublicKey: config.vapid.publicKey });
});

// POST /api/notifications/subscribe — register a push subscription
router.post("/subscribe", requireAuth, async (req, res) => {
  const { endpoint, keys, userAgent } = req.body;

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    res.status(400).json({ error: "Se requiere endpoint y keys (p256dh, auth)" });
    return;
  }

  try {
    await pool.query<PushSubscriptionRow>(
      `INSERT INTO push_subscriptions (user_id, endpoint, keys_p256dh, keys_auth, user_agent)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE
       SET user_id = $1, keys_p256dh = $3, keys_auth = $4, user_agent = $5`,
      [req.user!.userId, endpoint, keys.p256dh, keys.auth, userAgent || null],
    );

    res.json({ subscribed: true });
  } catch (err) {
    console.error("Push subscribe error:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// DELETE /api/notifications/subscribe — unregister a push subscription
router.delete("/subscribe", requireAuth, async (req, res) => {
  const { endpoint } = req.body;

  if (!endpoint) {
    res.status(400).json({ error: "Se requiere endpoint" });
    return;
  }

  try {
    await pool.query(
      "DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2",
      [endpoint, req.user!.userId],
    );

    res.json({ unsubscribed: true });
  } catch (err) {
    console.error("Push unsubscribe error:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// GET /api/notifications — list user's notifications (newest first)
router.get("/", requireAuth, async (req, res) => {
  const limit = Math.min(50, parseInt(req.query.limit as string) || 50);

  try {
    const result = await pool.query<NotificationRow>(
      `SELECT id, type, content, metadata, sent_at, opened_at, status, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [req.user!.userId, limit],
    );

    res.json({ notifications: result.rows });
  } catch (err) {
    console.error("List notifications error:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// PATCH /api/notifications/:id/opened — mark notification as opened
router.patch("/:id/opened", requireAuth, async (req, res) => {
  try {
    await markNotificationOpened(req.params.id as string, req.user!.userId);
    res.json({ opened: true });
  } catch (err) {
    console.error("Mark opened error:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// GET /api/notifications/preferences — get notification preferences
router.get("/preferences", requireAuth, async (req, res) => {
  try {
    const result = await pool.query<{ notification_prefs: Record<string, unknown> }>(
      "SELECT notification_prefs FROM users WHERE id = $1",
      [req.user!.userId],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }

    // Return with defaults for any missing keys
    const prefs = result.rows[0].notification_prefs;
    const defaults: Record<string, unknown> = {
      spending_alert: true,
      debt_payment_reminder: true,
      quincena_checkin: true,
      spending_alert_threshold: 0.80,
      debt_reminder_days: 3,
    };

    res.json({ preferences: { ...defaults, ...prefs } });
  } catch (err) {
    console.error("Get preferences error:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// PUT /api/notifications/preferences — update notification preferences
router.put("/preferences", requireAuth, async (req, res) => {
  const prefs = req.body;

  if (!prefs || typeof prefs !== "object") {
    res.status(400).json({ error: "Se requiere un objeto de preferencias" });
    return;
  }

  try {
    // Merge with existing preferences
    const current = await pool.query<{ notification_prefs: Record<string, unknown> }>(
      "SELECT notification_prefs FROM users WHERE id = $1",
      [req.user!.userId],
    );

    if (current.rows.length === 0) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }

    const merged = { ...current.rows[0].notification_prefs, ...prefs };

    await pool.query(
      "UPDATE users SET notification_prefs = $1 WHERE id = $2",
      [JSON.stringify(merged), req.user!.userId],
    );

    res.json({ preferences: merged });
  } catch (err) {
    console.error("Update preferences error:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

export default router;
