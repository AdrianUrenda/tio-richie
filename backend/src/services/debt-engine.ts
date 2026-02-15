// Debt analysis engine — deterministic calculations (never the LLM)
// Implements: revolving debt detection, avalanche/snowball payoff strategies (PRD 7.4, FR-406/407)

import { pool } from "../db/index.js";
import type {
  AccountRow,
  DebtInfo,
  DebtMilestone,
  DebtPayoffStrategy,
  DebtComparisonResult,
  DetectedDebt,
} from "../types/index.js";

// --- Debt detection from transaction patterns ---

/**
 * Scan credit accounts for revolving debt indicators:
 * - Interest charges in last 3 months
 * - Outstanding balances on credit accounts
 */
export async function detectRevolvingDebt(
  userId: string,
): Promise<DetectedDebt[]> {
  const creditAccounts = await pool.query<AccountRow>(
    "SELECT * FROM accounts WHERE user_id = $1 AND account_type = 'credit'",
    [userId],
  );

  const detectedDebts: DetectedDebt[] = [];

  for (const account of creditAccounts.rows) {
    const balance = Math.abs(Number(account.balance));
    if (balance <= 0) continue;

    // Check for interest charges in last 3 months
    const interestResult = await pool.query<{
      count: string;
      avg_amount: string;
    }>(
      `SELECT COUNT(*) as count, COALESCE(AVG(ABS(amount)), 0) as avg_amount
       FROM transactions
       WHERE account_id = $1
         AND amount < 0
         AND (description ~* 'inter[eé]s' OR description ~* 'cargo.*inter' OR category = 'Finanzas')
         AND date >= CURRENT_DATE - INTERVAL '3 months'`,
      [account.id],
    );

    // Check for recurring payments to estimate minimum payment
    const paymentsResult = await pool.query<{ amount: string }>(
      `SELECT ABS(amount) as amount
       FROM transactions
       WHERE account_id = $1 AND amount > 0
         AND date >= CURRENT_DATE - INTERVAL '3 months'
       ORDER BY date DESC
       LIMIT 6`,
      [account.id],
    );

    const hasInterestCharges = Number(interestResult.rows[0].count) >= 2;
    const avgInterest = Number(interestResult.rows[0].avg_amount);

    if (hasInterestCharges) {
      // Estimate annual interest rate from monthly interest charges
      const monthlyRate = avgInterest / balance;
      const annualRate = monthlyRate * 12;

      // Estimate minimum payment from recent payments
      let estimatedMinimum: number | null = null;
      if (paymentsResult.rows.length >= 2) {
        const payments = paymentsResult.rows.map((r) => Number(r.amount));
        estimatedMinimum = Math.min(...payments);
      }

      detectedDebts.push({
        accountId: account.id,
        accountName: account.name,
        currentBalance: balance,
        estimatedInterestRate:
          annualRate > 0 && annualRate < 2 ? annualRate : null,
        estimatedMinimumPayment: estimatedMinimum,
        confidence: "high",
      });
    } else {
      detectedDebts.push({
        accountId: account.id,
        accountName: account.name,
        currentBalance: balance,
        estimatedInterestRate: null,
        estimatedMinimumPayment: null,
        confidence: "low",
      });
    }
  }

  return detectedDebts;
}

// --- Payoff strategy calculations ---

const MAX_MONTHS = 360; // 30 year safety cap

/**
 * Calculate avalanche strategy (highest interest rate first).
 * This method minimizes total interest paid.
 */
export function calculateAvalanche(
  debts: DebtInfo[],
  totalMonthlyBudget: number,
): DebtPayoffStrategy {
  const sorted = [...debts].sort((a, b) => b.interestRate - a.interestRate);
  return simulatePayoff(sorted, totalMonthlyBudget, "avalanche");
}

/**
 * Calculate snowball strategy (smallest balance first).
 * This method provides quicker psychological wins.
 */
export function calculateSnowball(
  debts: DebtInfo[],
  totalMonthlyBudget: number,
): DebtPayoffStrategy {
  const sorted = [...debts].sort(
    (a, b) => a.currentBalance - b.currentBalance,
  );
  return simulatePayoff(sorted, totalMonthlyBudget, "snowball");
}

/**
 * Compare both strategies and return the difference.
 */
export function compareStrategies(
  debts: DebtInfo[],
  totalMonthlyBudget: number,
): DebtComparisonResult {
  const avalanche = calculateAvalanche(debts, totalMonthlyBudget);
  const snowball = calculateSnowball(debts, totalMonthlyBudget);

  return {
    avalanche,
    snowball,
    interestSaved: round2(
      snowball.totalInterestPaid - avalanche.totalInterestPaid,
    ),
    timeDifference: snowball.totalMonths - avalanche.totalMonths,
  };
}

/**
 * Month-by-month payoff simulation.
 * For each month:
 *   1. Apply monthly interest to all active debts
 *   2. Pay minimums on all active debts
 *   3. Apply remaining budget to the target debt (first in sorted order)
 *   4. Record milestones
 */
function simulatePayoff(
  debts: DebtInfo[],
  totalMonthlyBudget: number,
  method: "avalanche" | "snowball",
): DebtPayoffStrategy {
  const balances = debts.map((d) => d.currentBalance);
  const monthlyRates = debts.map((d) => d.interestRate / 12);
  const minimums = debts.map((d) => d.minimumPayment);
  const milestones: DebtMilestone[][] = debts.map(() => []);
  const totalInterest = debts.map(() => 0);
  const totalPaid = debts.map(() => 0);
  const payoffMonth = debts.map(() => 0);

  let month = 0;

  while (balances.some((b) => b > 0.01) && month < MAX_MONTHS) {
    month++;

    // 1. Apply monthly interest
    for (let i = 0; i < debts.length; i++) {
      if (balances[i] <= 0.01) continue;
      const interest = balances[i] * monthlyRates[i];
      balances[i] += interest;
      totalInterest[i] += interest;
    }

    // 2. Pay minimums on all active debts
    let availableBudget = totalMonthlyBudget;
    for (let i = 0; i < debts.length; i++) {
      if (balances[i] <= 0.01) continue;
      const payment = Math.min(minimums[i], balances[i], availableBudget);
      balances[i] -= payment;
      totalPaid[i] += payment;
      availableBudget -= payment;
    }

    // 3. Apply extra to the target debt (first non-zero in sorted order)
    for (let i = 0; i < debts.length; i++) {
      if (balances[i] <= 0.01 || availableBudget <= 0) continue;
      const extra = Math.min(availableBudget, balances[i]);
      balances[i] -= extra;
      totalPaid[i] += extra;
      availableBudget -= extra;
      break; // Only the target debt gets the extra
    }

    // 4. Record milestones and detect payoff
    for (let i = 0; i < debts.length; i++) {
      if (balances[i] <= 0.01 && payoffMonth[i] === 0) {
        payoffMonth[i] = month;
        balances[i] = 0;
      }

      // Record monthly milestones for first year, then every 3 months
      if (month <= 12 || month % 3 === 0) {
        milestones[i].push({
          month,
          balance: Math.max(0, round2(balances[i])),
          interestPaid: round2(totalInterest[i]),
          cumulativeInterest: round2(totalInterest[i]),
        });
      }
    }
  }

  return {
    method,
    debts: debts.map((d, i) => ({
      name: d.name,
      goalId: d.goalId,
      payoffOrder: i + 1,
      monthsToPayoff: payoffMonth[i],
      totalInterestPaid: round2(totalInterest[i]),
      totalPaid: round2(totalPaid[i]),
      milestones: milestones[i],
    })),
    totalMonths: Math.max(...payoffMonth),
    totalInterestPaid: round2(totalInterest.reduce((a, b) => a + b, 0)),
    totalPaid: round2(totalPaid.reduce((a, b) => a + b, 0)),
    monthlyPayment: totalMonthlyBudget,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
