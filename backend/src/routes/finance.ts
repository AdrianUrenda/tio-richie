// Finance routes — safe-to-spend calculation using full formula from Appendix C

import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { calculateSafeToSpend } from "../services/financial-engine.js";

const router = Router();

// GET /api/finance/safe-to-spend
// Formula: (Remaining Disposable Income − Committed Upcoming Expenses − Goal Contributions Due) / Remaining Days in Period
router.get("/safe-to-spend", requireAuth, async (req, res) => {
  try {
    const result = await calculateSafeToSpend(req.user!.userId);
    res.json(result);
  } catch (err) {
    console.error("Safe-to-spend error:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

export default router;
