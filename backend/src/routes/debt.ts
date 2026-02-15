// Debt analysis routes — detection, goal management, strategy calculation
// PRD section 7.4, FR-406, FR-407

import { Router } from "express";
import { pool } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import {
  detectRevolvingDebt,
  compareStrategies,
  calculateAvalanche,
  calculateSnowball,
} from "../services/debt-engine.js";
import type { DebtInfo, GoalRow } from "../types/index.js";

const router = Router();

// GET /api/debt/detect — detect revolving debt from transaction patterns
router.get("/detect", requireAuth, async (req, res) => {
  try {
    const debts = await detectRevolvingDebt(req.user!.userId);
    res.json({ debts });
  } catch (err) {
    console.error("Debt detection error:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// POST /api/debt/goals — create a debt payoff goal with debt-specific fields
router.post("/goals", requireAuth, async (req, res) => {
  const {
    name,
    currentBalance,
    interestRate,
    minimumPayment,
    paymentDueDay,
    debtAccountId,
    deadline,
  } = req.body;

  if (!currentBalance || currentBalance <= 0) {
    res.status(400).json({ error: "Se requiere un saldo mayor a 0" });
    return;
  }
  if (!interestRate || interestRate <= 0) {
    res.status(400).json({ error: "Se requiere la tasa de interés" });
    return;
  }
  if (!minimumPayment || minimumPayment <= 0) {
    res.status(400).json({ error: "Se requiere el pago mínimo" });
    return;
  }

  try {
    const result = await pool.query<GoalRow>(
      `INSERT INTO goals (user_id, type, target_amount, current_amount,
         deadline, status, interest_rate, minimum_payment,
         current_balance, payment_due_day, debt_account_id)
       VALUES ($1, 'debt_payoff', $2, 0, $3, 'active', $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        req.user!.userId,
        currentBalance,
        deadline || null,
        interestRate,
        minimumPayment,
        currentBalance,
        paymentDueDay || null,
        debtAccountId || null,
      ],
    );

    res.status(201).json({ goal: result.rows[0] });
  } catch (err) {
    console.error("Create debt goal error:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// GET /api/debt/goals — list active debt payoff goals
router.get("/goals", requireAuth, async (req, res) => {
  try {
    const result = await pool.query<GoalRow>(
      `SELECT * FROM goals
       WHERE user_id = $1 AND type = 'debt_payoff' AND status = 'active'
       ORDER BY priority DESC, created_at ASC`,
      [req.user!.userId],
    );

    res.json({ goals: result.rows });
  } catch (err) {
    console.error("List debt goals error:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// POST /api/debt/calculate — calculate avalanche vs snowball comparison
router.post("/calculate", requireAuth, async (req, res) => {
  const { debts, totalMonthlyBudget } = req.body as {
    debts: DebtInfo[];
    totalMonthlyBudget: number;
  };

  if (!debts || !Array.isArray(debts) || debts.length === 0) {
    res.status(400).json({ error: "Se requiere al menos una deuda" });
    return;
  }
  if (!totalMonthlyBudget || totalMonthlyBudget <= 0) {
    res.status(400).json({ error: "Se requiere el presupuesto mensual total" });
    return;
  }

  // Validate minimum payment covers at least all minimums
  const totalMinimums = debts.reduce((sum, d) => sum + d.minimumPayment, 0);
  if (totalMonthlyBudget < totalMinimums) {
    res.status(400).json({
      error: `El presupuesto mensual debe cubrir al menos los pagos mínimos ($${totalMinimums.toLocaleString("es-MX")})`,
    });
    return;
  }

  try {
    const comparison = compareStrategies(debts, totalMonthlyBudget);
    res.json(comparison);
  } catch (err) {
    console.error("Debt calculation error:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// PUT /api/debt/goals/:id/strategy — set the active strategy and store milestones
router.put("/goals/:id/strategy", requireAuth, async (req, res) => {
  const { method } = req.body as { method: "avalanche" | "snowball" };

  if (method !== "avalanche" && method !== "snowball") {
    res.status(400).json({ error: "El método debe ser 'avalanche' o 'snowball'" });
    return;
  }

  try {
    // Fetch goal
    const goalResult = await pool.query<GoalRow>(
      "SELECT * FROM goals WHERE id = $1 AND user_id = $2 AND type = 'debt_payoff'",
      [req.params.id, req.user!.userId],
    );

    if (goalResult.rows.length === 0) {
      res.status(404).json({ error: "Meta de deuda no encontrada" });
      return;
    }

    const goal = goalResult.rows[0];

    // Build DebtInfo from the goal
    const debtInfo: DebtInfo = {
      goalId: goal.id,
      name: `Deuda ${goal.id.slice(0, 8)}`,
      currentBalance: Number(goal.current_balance),
      interestRate: Number(goal.interest_rate),
      minimumPayment: Number(goal.minimum_payment),
      paymentDueDay: goal.payment_due_day || 1,
    };

    // Also fetch other active debt goals for combined strategy
    const allDebtsResult = await pool.query<GoalRow>(
      "SELECT * FROM goals WHERE user_id = $1 AND type = 'debt_payoff' AND status = 'active'",
      [req.user!.userId],
    );

    const allDebts: DebtInfo[] = allDebtsResult.rows.map((g) => ({
      goalId: g.id,
      name: `Deuda ${g.id.slice(0, 8)}`,
      currentBalance: Number(g.current_balance),
      interestRate: Number(g.interest_rate),
      minimumPayment: Number(g.minimum_payment),
      paymentDueDay: g.payment_due_day || 1,
    }));

    // Calculate with total budget = sum of minimums + extra from this goal
    const totalMinimums = allDebts.reduce(
      (sum, d) => sum + d.minimumPayment,
      0,
    );
    // Use 1.5x minimums as default budget if user hasn't specified extra
    const totalBudget = Math.max(
      totalMinimums,
      totalMinimums * 1.5,
    );

    const calculate =
      method === "avalanche" ? calculateAvalanche : calculateSnowball;
    const strategy = calculate(allDebts, totalBudget);

    // Find milestones for this specific goal
    const goalStrategy = strategy.debts.find((d) => d.goalId === goal.id);
    const milestones = goalStrategy?.milestones || [];

    // Update goal with strategy and milestones
    await pool.query(
      `UPDATE goals SET strategy = $1, milestones = $2 WHERE id = $3`,
      [method, JSON.stringify(milestones), goal.id],
    );

    res.json({
      strategy: method,
      milestones,
      totalMonths: strategy.totalMonths,
      totalInterestPaid: strategy.totalInterestPaid,
    });
  } catch (err) {
    console.error("Set strategy error:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// GET /api/debt/goals/:id/progress — get progress on a debt goal
router.get("/goals/:id/progress", requireAuth, async (req, res) => {
  try {
    const goalResult = await pool.query<GoalRow>(
      "SELECT * FROM goals WHERE id = $1 AND user_id = $2 AND type = 'debt_payoff'",
      [req.params.id, req.user!.userId],
    );

    if (goalResult.rows.length === 0) {
      res.status(404).json({ error: "Meta de deuda no encontrada" });
      return;
    }

    const goal = goalResult.rows[0];
    const targetAmount = Number(goal.target_amount) || Number(goal.current_balance);
    const currentBalance = Number(goal.current_balance);
    const amountPaid = targetAmount - currentBalance;
    const percentPaid =
      targetAmount > 0 ? Math.round((amountPaid / targetAmount) * 100) : 0;

    res.json({
      goal: {
        id: goal.id,
        strategy: goal.strategy,
        targetAmount,
        currentBalance,
        amountPaid,
        percentPaid,
        interestRate: Number(goal.interest_rate),
        minimumPayment: Number(goal.minimum_payment),
        paymentDueDay: goal.payment_due_day,
        milestones: goal.milestones,
      },
    });
  } catch (err) {
    console.error("Debt progress error:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

export default router;
