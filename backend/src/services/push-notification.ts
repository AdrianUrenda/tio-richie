// Push notification service — wraps web-push, handles sending + DB persistence
// FR-500: Web push via service worker

import webPush from "web-push";
import { pool } from "../db/index.js";
import { config } from "../config.js";
import type { PushSubscriptionRow, NotificationType } from "../types/index.js";

// Initialize VAPID details
if (config.vapid.publicKey && config.vapid.privateKey) {
  webPush.setVapidDetails(
    config.vapid.subject,
    config.vapid.publicKey,
    config.vapid.privateKey,
  );
}

export interface NotificationPayload {
  title: string;
  body: string;
  data: {
    type: NotificationType;
    notificationId: string;
    url: string;
  };
}

/**
 * Send a push notification to all of a user's subscribed devices.
 * Creates a notification record in the DB regardless of push delivery.
 */
export async function sendPushToUser(
  userId: string,
  type: NotificationType,
  content: string,
  payload: NotificationPayload,
  metadata: Record<string, unknown> = {},
): Promise<string> {
  // Check user notification preferences
  const userResult = await pool.query<{ notification_prefs: Record<string, unknown> }>(
    "SELECT notification_prefs FROM users WHERE id = $1",
    [userId],
  );
  if (userResult.rows.length === 0) {
    throw new Error("User not found");
  }

  const prefs = userResult.rows[0].notification_prefs;
  if (prefs[type] === false) {
    // User disabled this type — record but skip push
    const notifResult = await pool.query<{ id: string }>(
      `INSERT INTO notifications (user_id, type, content, metadata, status)
       VALUES ($1, $2, $3, $4, 'skipped')
       RETURNING id`,
      [userId, type, content, JSON.stringify(metadata)],
    );
    return notifResult.rows[0].id;
  }

  // Create notification record
  const notifResult = await pool.query<{ id: string }>(
    `INSERT INTO notifications (user_id, type, content, metadata, status)
     VALUES ($1, $2, $3, $4, 'pending')
     RETURNING id`,
    [userId, type, content, JSON.stringify(metadata)],
  );
  const notificationId = notifResult.rows[0].id;

  // Set the actual notification ID in the payload
  payload.data.notificationId = notificationId;

  // Fetch all push subscriptions for this user
  const subsResult = await pool.query<PushSubscriptionRow>(
    "SELECT * FROM push_subscriptions WHERE user_id = $1",
    [userId],
  );

  if (subsResult.rows.length === 0) {
    // No push subscriptions — mark as sent (exists in DB for in-app display)
    await pool.query(
      "UPDATE notifications SET status = 'sent', sent_at = NOW() WHERE id = $1",
      [notificationId],
    );
    return notificationId;
  }

  // Send to all subscriptions
  let anySent = false;
  for (const sub of subsResult.rows) {
    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
    };

    try {
      await webPush.sendNotification(
        pushSubscription,
        JSON.stringify(payload),
      );
      anySent = true;
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 410 || statusCode === 404) {
        // Subscription expired — clean up
        await pool.query(
          "DELETE FROM push_subscriptions WHERE id = $1",
          [sub.id],
        );
      } else {
        console.error(`Push send failed for sub ${sub.id}:`, err);
      }
    }
  }

  // Update notification status
  await pool.query(
    "UPDATE notifications SET status = $1, sent_at = NOW() WHERE id = $2",
    [anySent ? "sent" : "failed", notificationId],
  );

  return notificationId;
}

/**
 * Mark a notification as opened by the user.
 */
export async function markNotificationOpened(
  notificationId: string,
  userId: string,
): Promise<void> {
  await pool.query(
    "UPDATE notifications SET opened_at = NOW(), status = 'opened' WHERE id = $1 AND user_id = $2",
    [notificationId, userId],
  );
}
