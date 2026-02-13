import { Router } from "express";
import { pool } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// GET /api/finance/safe-to-spend
// Formula: (Remaining Disposable Income − Committed Upcoming Expenses − Goal Contributions Due) / Remaining Days in Period
router.get("/safe-to-spend", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;

    // Determine current quincena period (1st-14th or 15th-end of month)
    const now = new Date();
    const day = now.getDate();
    const year = now.getFullYear();
    const month = now.getMonth();

    let periodStart: Date;
    let periodEnd: Date;

    if (day < 15) {
      periodStart = new Date(year, month, 1);
      periodEnd = new Date(year, month, 14);
    } else {
      periodStart = new Date(year, month, 15);
      periodEnd = new Date(year, month + 1, 0); // last day of month
    }

    const remainingDays = Math.max(1, Math.ceil((periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) + 1);

    // Sum account balances (checking + savings)
    const balanceResult = await pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(balance), 0) as total
       FROM accounts WHERE user_id = $1 AND account_type IN ('checking', 'savings')`,
      [userId],
    );
    const totalBalance = Number(balanceResult.rows[0].total);

    // Sum spending this period
    const spentResult = await pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(ABS(amount)), 0) as total
       FROM transactions WHERE user_id = $1 AND amount < 0 AND date >= $2 AND date <= $3`,
      [userId, periodStart.toISOString(), periodEnd.toISOString()],
    );
    const totalSpent = Number(spentResult.rows[0].total);

    // Sum active goal contributions (prorated to this quincena)
    const goalsResult = await pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(target_amount - current_amount), 0) as total
       FROM goals WHERE user_id = $1 AND status = 'active' AND deadline IS NOT NULL`,
      [userId],
    );
    const goalRemaining = Number(goalsResult.rows[0].total);

    // Simple safe-to-spend: available balance / remaining days
    // Full formula will factor in committed expenses and goal contributions once data flows are wired
    const dailyAmount = totalBalance > 0 ? Math.floor(totalBalance / remainingDays) : 0;

    res.json({
      safeToSpend: dailyAmount,
      currency: "MXN",
      remainingDays,
      periodStart: periodStart.toISOString().split("T")[0],
      periodEnd: periodEnd.toISOString().split("T")[0],
      totalBalance,
      totalSpent,
      hasData: totalBalance > 0,
    });
  } catch (err) {
    console.error("Safe-to-spend error:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

export default router;
