// Financial engine — deterministic calculations (never the LLM)
// Implements: quincena period management, income detection, safe-to-spend formula

import { pool } from "../db/index.js";
import type { QuincenaPeriod, SafeToSpendResult } from "../types/index.js";

// --- Quincena period management ---
// Mexican payroll: 1st and 15th of each month

export function getCurrentQuincena(date: Date = new Date()): QuincenaPeriod {
  const day = date.getDate();
  const year = date.getFullYear();
  const month = date.getMonth();

  let start: Date;
  let end: Date;

  if (day < 15) {
    start = new Date(year, month, 1);
    end = new Date(year, month, 14, 23, 59, 59, 999);
  } else {
    start = new Date(year, month, 15);
    end = new Date(year, month + 1, 0, 23, 59, 59, 999); // last day of month
  }

  const now = new Date(year, month, day);
  const remainingDays = Math.max(
    1,
    Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) + 1,
  );

  return { start, end, remainingDays };
}

export function formatDateForDb(d: Date): string {
  return d.toISOString().split("T")[0];
}

// --- Income detection ---

export async function detectQuincenaIncome(
  userId: string,
  period: QuincenaPeriod,
): Promise<number> {
  // Sum all positive (income) transactions in this period
  const result = await pool.query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0) as total
     FROM transactions
     WHERE user_id = $1 AND amount > 0 AND date >= $2 AND date <= $3`,
    [userId, formatDateForDb(period.start), formatDateForDb(period.end)],
  );
  return Number(result.rows[0].total);
}

/**
 * Estimate half-monthly income from historical data when no transactions exist yet
 * in the current period. Looks at last 3 months of income.
 */
export async function estimateQuincenaIncome(userId: string): Promise<number> {
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const result = await pool.query<{ total: string; count: string }>(
    `SELECT COALESCE(SUM(amount), 0) as total,
            COUNT(DISTINCT DATE_TRUNC('month', date)) as count
     FROM transactions
     WHERE user_id = $1 AND amount > 0 AND date >= $2
       AND (category = 'Ingreso' OR amount > 0)`,
    [userId, formatDateForDb(threeMonthsAgo)],
  );

  const totalIncome = Number(result.rows[0].total);
  const monthCount = Math.max(1, Number(result.rows[0].count));
  // Divide by 2 to get per-quincena estimate
  return Math.floor(totalIncome / monthCount / 2);
}

// --- Committed (recurring) expenses ---

export async function getCommittedExpenses(
  userId: string,
  period: QuincenaPeriod,
): Promise<number> {
  // Get recurring expenses that haven't been paid yet in this period
  // Step 1: Find recurring expense categories from past transactions
  const recurringResult = await pool.query<{ avg_amount: string }>(
    `SELECT COALESCE(SUM(avg_amount), 0) as avg_amount FROM (
       SELECT ABS(AVG(amount)) as avg_amount
       FROM transactions
       WHERE user_id = $1
         AND is_recurring = true
         AND amount < 0
         AND date >= (CURRENT_DATE - INTERVAL '3 months')
       GROUP BY category, subcategory
     ) recurring`,
    [userId],
  );
  const totalRecurring = Number(recurringResult.rows[0].avg_amount);

  // Step 2: Subtract recurring expenses already paid this period
  const paidResult = await pool.query<{ total: string }>(
    `SELECT COALESCE(SUM(ABS(amount)), 0) as total
     FROM transactions
     WHERE user_id = $1
       AND is_recurring = true
       AND amount < 0
       AND date >= $2 AND date <= $3`,
    [userId, formatDateForDb(period.start), formatDateForDb(period.end)],
  );
  const alreadyPaid = Number(paidResult.rows[0].total);

  // Per-quincena recurring ≈ monthly / 2
  const perQuincena = totalRecurring / 2;
  return Math.max(0, perQuincena - alreadyPaid);
}

// --- Goal contributions ---

export async function getGoalContributions(
  userId: string,
): Promise<number> {
  // Calculate required contributions for active goals in this quincena
  const result = await pool.query<{
    target_amount: string;
    current_amount: string;
    deadline: string;
  }>(
    `SELECT target_amount, current_amount, deadline
     FROM goals
     WHERE user_id = $1 AND status = 'active' AND deadline IS NOT NULL AND target_amount IS NOT NULL`,
    [userId],
  );

  let totalContribution = 0;
  const now = new Date();

  for (const goal of result.rows) {
    const remaining = Number(goal.target_amount) - Number(goal.current_amount);
    if (remaining <= 0) continue;

    const deadline = new Date(goal.deadline);
    const msRemaining = deadline.getTime() - now.getTime();
    if (msRemaining <= 0) continue;

    // Number of quincenas until deadline
    const daysRemaining = msRemaining / (1000 * 60 * 60 * 24);
    const quincenasRemaining = Math.max(1, Math.ceil(daysRemaining / 15));

    totalContribution += remaining / quincenasRemaining;
  }

  return Math.floor(totalContribution);
}

// --- Total spending in period ---

export async function getSpentThisPeriod(
  userId: string,
  period: QuincenaPeriod,
): Promise<number> {
  const result = await pool.query<{ total: string }>(
    `SELECT COALESCE(SUM(ABS(amount)), 0) as total
     FROM transactions
     WHERE user_id = $1 AND amount < 0 AND date >= $2 AND date <= $3`,
    [userId, formatDateForDb(period.start), formatDateForDb(period.end)],
  );
  return Number(result.rows[0].total);
}

// --- Account balances ---

export async function getTotalBalance(userId: string): Promise<number> {
  const result = await pool.query<{ total: string }>(
    `SELECT COALESCE(SUM(balance), 0) as total
     FROM accounts
     WHERE user_id = $1 AND account_type IN ('checking', 'savings')`,
    [userId],
  );
  return Number(result.rows[0].total);
}

// --- Safe-to-spend: the full formula ---
// Safe-to-Spend Today = (Remaining Disposable Income − Committed Upcoming Expenses − Goal Contributions Due) / Remaining Days in Period

export async function calculateSafeToSpend(userId: string): Promise<SafeToSpendResult> {
  const period = getCurrentQuincena();

  const [
    periodIncome,
    estimatedIncome,
    spentThisPeriod,
    committedExpenses,
    goalContributions,
    totalBalance,
  ] = await Promise.all([
    detectQuincenaIncome(userId, period),
    estimateQuincenaIncome(userId),
    getSpentThisPeriod(userId, period),
    getCommittedExpenses(userId, period),
    getGoalContributions(userId),
    getTotalBalance(userId),
  ]);

  // Use actual period income if available, otherwise estimated
  const disposableIncome = periodIncome > 0 ? periodIncome : estimatedIncome;

  // Remaining disposable = income - already spent
  const remainingDisposable = Math.max(0, disposableIncome - spentThisPeriod);

  // Apply full formula
  const numerator = remainingDisposable - committedExpenses - goalContributions;
  const safeToSpend = Math.max(0, Math.floor(numerator / period.remainingDays));

  const hasData = totalBalance > 0 || periodIncome > 0 || spentThisPeriod > 0;

  return {
    safeToSpend,
    currency: "MXN",
    remainingDays: period.remainingDays,
    periodStart: formatDateForDb(period.start),
    periodEnd: formatDateForDb(period.end),
    disposableIncome,
    spentThisPeriod,
    committedExpenses,
    goalContributions,
    totalBalance,
    hasData,
  };
}

// --- Build financial context for the LLM ---

export async function buildFinancialSummary(userId: string): Promise<string> {
  const parts: string[] = [];

  // Accounts
  const accounts = await pool.query(
    "SELECT name, account_type, balance, currency FROM accounts WHERE user_id = $1",
    [userId],
  );
  if (accounts.rows.length > 0) {
    const summary = accounts.rows
      .map(
        (a) =>
          `- ${a.name} (${a.account_type}): $${Number(a.balance).toLocaleString("es-MX")} ${a.currency}`,
      )
      .join("\n");
    parts.push(`Cuentas:\n${summary}`);
  }

  // Safe-to-spend
  try {
    const sts = await calculateSafeToSpend(userId);
    if (sts.hasData) {
      parts.push(
        `Puede gastar hoy: $${sts.safeToSpend.toLocaleString("es-MX")} MXN/día` +
          `\nQuincena: ${sts.periodStart} a ${sts.periodEnd} (${sts.remainingDays} días restantes)` +
          `\nIngreso del periodo: $${sts.disposableIncome.toLocaleString("es-MX")}` +
          `\nGastado este periodo: $${sts.spentThisPeriod.toLocaleString("es-MX")}` +
          `\nGastos comprometidos pendientes: $${sts.committedExpenses.toLocaleString("es-MX")}` +
          `\nAportaciones a metas pendientes: $${sts.goalContributions.toLocaleString("es-MX")}`,
      );
    }
  } catch {
    // Safe-to-spend not available
  }

  // Recent spending by category (this month)
  const spending = await pool.query<{ category: string; total: string }>(
    `SELECT category, COALESCE(SUM(ABS(amount)), 0) as total
     FROM transactions
     WHERE user_id = $1 AND amount < 0
       AND date >= DATE_TRUNC('month', CURRENT_DATE)
     GROUP BY category ORDER BY total DESC LIMIT 5`,
    [userId],
  );
  if (spending.rows.length > 0) {
    const summary = spending.rows
      .map((r) => `- ${r.category || "Sin categoría"}: $${Number(r.total).toLocaleString("es-MX")}`)
      .join("\n");
    parts.push(`Gasto por categoría (este mes):\n${summary}`);
  }

  // Goals
  const goals = await pool.query(
    "SELECT type, target_amount, current_amount, deadline, status FROM goals WHERE user_id = $1 AND status = 'active'",
    [userId],
  );
  if (goals.rows.length > 0) {
    const summary = goals.rows
      .map((g) => {
        const pct =
          g.target_amount > 0
            ? Math.round((Number(g.current_amount) / Number(g.target_amount)) * 100)
            : 0;
        return `- ${g.type}: $${Number(g.current_amount).toLocaleString("es-MX")} / $${Number(g.target_amount).toLocaleString("es-MX")} (${pct}%)${g.deadline ? ` — meta: ${g.deadline}` : ""}`;
      })
      .join("\n");
    parts.push(`Metas activas:\n${summary}`);
  }

  if (parts.length === 0) {
    return "El usuario aún no ha conectado cuentas bancarias ni configurado metas financieras. Es un usuario nuevo — dale la bienvenida y ofrécele orientación inicial.";
  }

  return parts.join("\n\n");
}
