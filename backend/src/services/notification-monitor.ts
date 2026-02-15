// Notification monitor — scheduled checks for financial events
// FR-501: Spending alerts, FR-504: Debt payment reminders, FR-505: Quincena check-ins

import cron from "node-cron";
import { pool } from "../db/index.js";
import {
  sendPushToUser,
  type NotificationPayload,
} from "./push-notification.js";
import {
  getCurrentQuincena,
  formatDateForDb,
} from "./financial-engine.js";

/**
 * Start all notification monitoring cron jobs.
 * Called once from index.ts after the server starts.
 */
export function startNotificationMonitor(): void {
  // FR-501: Budget spending alerts — every 15 minutes
  cron.schedule(
    "*/15 * * * *",
    async () => {
      await checkBudgetAlerts().catch((err) =>
        console.error("Budget alert check failed:", err),
      );
    },
    { timezone: "America/Mexico_City" },
  );

  // FR-504: Debt payment reminders — daily at 9am Mexico City
  cron.schedule(
    "0 9 * * *",
    async () => {
      await checkDebtPaymentReminders().catch((err) =>
        console.error("Debt payment reminder check failed:", err),
      );
    },
    { timezone: "America/Mexico_City" },
  );

  // FR-505: Quincena check-in — 1st and 15th at 10am Mexico City
  cron.schedule(
    "0 10 1,15 * *",
    async () => {
      await sendQuincenaCheckins().catch((err) =>
        console.error("Quincena check-in failed:", err),
      );
    },
    { timezone: "America/Mexico_City" },
  );

  console.log("Notification monitor started");
}

// --- FR-501: Budget spending alerts ---

async function checkBudgetAlerts(): Promise<void> {
  // Get all users with budgets that have category limits
  const budgets = await pool.query<{
    user_id: string;
    budget_id: string;
    categories: Array<{ name: string; limit: number }>;
    notification_prefs: Record<string, unknown>;
  }>(
    `SELECT b.user_id, b.id as budget_id, b.categories,
            u.notification_prefs
     FROM budgets b
     JOIN users u ON b.user_id = u.id
     WHERE b.categories != '[]'::jsonb`,
  );

  const currentPeriod = getCurrentQuincena();

  for (const row of budgets.rows) {
    const threshold =
      typeof row.notification_prefs?.spending_alert_threshold === "number"
        ? (row.notification_prefs.spending_alert_threshold as number)
        : 0.8;

    const categories = row.categories;

    for (const cat of categories) {
      if (!cat.limit || cat.limit <= 0) continue;

      // Query spending for this category in current period
      const spentResult = await pool.query<{ total: string }>(
        `SELECT COALESCE(SUM(ABS(amount)), 0) as total
         FROM transactions
         WHERE user_id = $1 AND category = $2 AND amount < 0
           AND date >= $3 AND date <= $4`,
        [
          row.user_id,
          cat.name,
          formatDateForDb(currentPeriod.start),
          formatDateForDb(currentPeriod.end),
        ],
      );
      const spent = Number(spentResult.rows[0].total);
      const percentUsed = spent / cat.limit;

      if (percentUsed >= threshold) {
        // Check if already notified this period for this category
        const existing = await pool.query(
          `SELECT 1 FROM notifications
           WHERE user_id = $1 AND type = 'spending_alert'
             AND metadata->>'category' = $2
             AND created_at >= $3
           LIMIT 1`,
          [row.user_id, cat.name, formatDateForDb(currentPeriod.start)],
        );

        if (existing.rows.length > 0) continue;

        const pct = Math.round(percentUsed * 100);
        const content = `Ya usaste el ${pct}% de tu presupuesto de ${cat.name} esta quincena ($${spent.toLocaleString("es-MX")} de $${cat.limit.toLocaleString("es-MX")}). ¿Quieres que revisemos juntos cómo ajustar?`;

        const payload: NotificationPayload = {
          title: "Tío Richie",
          body: `Ojo, sobrino: ya vas en el ${pct}% de ${cat.name}`,
          data: {
            type: "spending_alert",
            notificationId: "",
            url: `/chat?context=spending_alert&category=${encodeURIComponent(cat.name)}&percent=${pct}`,
          },
        };

        await sendPushToUser(
          row.user_id,
          "spending_alert",
          content,
          payload,
          {
            category: cat.name,
            budgetId: row.budget_id,
            percentUsed: pct,
            spent,
            limit: cat.limit,
          },
        );
      }
    }
  }
}

// --- FR-504: Debt payment reminders ---

async function checkDebtPaymentReminders(): Promise<void> {
  const today = new Date();
  const currentDay = today.getDate();
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();

  const debtGoals = await pool.query<{
    goal_id: string;
    user_id: string;
    payment_due_day: number;
    minimum_payment: string;
    current_balance: string;
    notification_prefs: Record<string, unknown>;
  }>(
    `SELECT g.id as goal_id, g.user_id, g.payment_due_day, g.minimum_payment,
            g.current_balance, u.notification_prefs
     FROM goals g
     JOIN users u ON g.user_id = u.id
     WHERE g.type = 'debt_payoff' AND g.status = 'active' AND g.payment_due_day IS NOT NULL`,
  );

  for (const debt of debtGoals.rows) {
    const reminderDays =
      typeof debt.notification_prefs?.debt_reminder_days === "number"
        ? (debt.notification_prefs.debt_reminder_days as number)
        : 3;

    // Calculate next due date
    let dueDate = new Date(currentYear, currentMonth, debt.payment_due_day);
    if (dueDate.getTime() <= today.getTime() && currentDay > debt.payment_due_day) {
      dueDate = new Date(currentYear, currentMonth + 1, debt.payment_due_day);
    }

    const daysUntilDue = Math.ceil(
      (dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysUntilDue <= reminderDays && daysUntilDue >= 0) {
      // Check if already notified for this due date
      const monthStart = new Date(currentYear, currentMonth, 1);
      const existing = await pool.query(
        `SELECT 1 FROM notifications
         WHERE user_id = $1 AND type = 'debt_payment_reminder'
           AND metadata->>'goalId' = $2
           AND created_at >= $3
         LIMIT 1`,
        [debt.user_id, debt.goal_id, formatDateForDb(monthStart)],
      );
      if (existing.rows.length > 0) continue;

      const minPay = Number(debt.minimum_payment);
      const dayWord =
        daysUntilDue === 0
          ? "hoy"
          : daysUntilDue === 1
            ? "mañana"
            : `en ${daysUntilDue} días`;

      const content = `Tu pago de deuda vence ${dayWord}. El mínimo es $${minPay.toLocaleString("es-MX")} MXN. ¿Revisamos si puedes abonar más para avanzar en tu meta?`;

      const payload: NotificationPayload = {
        title: "Tío Richie",
        body: `Pago de deuda vence ${dayWord}: $${minPay.toLocaleString("es-MX")}`,
        data: {
          type: "debt_payment_reminder",
          notificationId: "",
          url: `/chat?context=debt_payment_reminder&goalId=${debt.goal_id}`,
        },
      };

      await sendPushToUser(
        debt.user_id,
        "debt_payment_reminder",
        content,
        payload,
        {
          goalId: debt.goal_id,
          daysUntilDue,
          minimumPayment: minPay,
        },
      );
    }
  }
}

// --- FR-505: Quincena check-ins ---

async function sendQuincenaCheckins(): Promise<void> {
  // All users who have at least some financial data (accounts)
  const users = await pool.query<{
    id: string;
    notification_prefs: Record<string, unknown>;
  }>(
    `SELECT DISTINCT u.id, u.notification_prefs
     FROM users u
     INNER JOIN accounts a ON a.user_id = u.id`,
  );

  for (const user of users.rows) {
    const content =
      "¡Llegó la quincena! ¿Quieres que revisemos cómo te fue y armemos el plan para estos 15 días?";

    const payload: NotificationPayload = {
      title: "Tío Richie",
      body: "¡Llegó la quincena! Revisemos tu plan.",
      data: {
        type: "quincena_checkin",
        notificationId: "",
        url: "/chat?context=quincena_checkin",
      },
    };

    await sendPushToUser(
      user.id,
      "quincena_checkin",
      content,
      payload,
      {},
    );
  }
}
