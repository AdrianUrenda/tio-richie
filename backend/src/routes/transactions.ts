// Transaction routes — CSV upload with AI categorization, listing, and manual recategorization

import { Router } from "express";
import multer from "multer";
import { pool } from "../db/index.js";
import { config } from "../config.js";
import { requireAuth } from "../middleware/auth.js";
import { categorizeTransactions, categorizeByRules, detectIncome } from "../services/categorization.js";
import type { AccountRow, TransactionRow, CsvTransactionInput } from "../types/index.js";

const router = Router();

// Multer config: 5MB max, memory storage (no disk writes)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxCsvSizeMb * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Solo se aceptan archivos CSV"));
    }
  },
});

// POST /api/transactions/upload-csv — upload CSV, auto-categorize, store
router.post("/upload-csv", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No se recibió ningún archivo" });
    return;
  }

  const accountId = req.body.accountId;

  try {
    // Parse CSV
    const csvText = req.file.buffer.toString("utf-8");
    const parsed = parseCsv(csvText);

    if (parsed.length === 0) {
      res.status(400).json({ error: "El archivo CSV está vacío o no tiene un formato válido" });
      return;
    }

    // Create a CSV-sourced account if none specified
    let targetAccountId = accountId;
    if (!targetAccountId) {
      const existing = await pool.query<AccountRow>(
        "SELECT id FROM accounts WHERE user_id = $1 AND name = 'Cuenta CSV' LIMIT 1",
        [req.user!.userId],
      );

      if (existing.rows.length > 0) {
        targetAccountId = existing.rows[0].id;
      } else {
        const newAccount = await pool.query<AccountRow>(
          `INSERT INTO accounts (user_id, account_type, name, balance, currency)
           VALUES ($1, 'checking', 'Cuenta CSV', 0, 'MXN')
           RETURNING id`,
          [req.user!.userId],
        );
        targetAccountId = newAccount.rows[0].id;
      }
    }

    // Categorize all transactions (rules + AI fallback)
    const categories = await categorizeTransactions(parsed);

    // Bulk insert
    let imported = 0;
    let skipped = 0;

    for (let i = 0; i < parsed.length; i++) {
      const tx = parsed[i];
      const cat = categories[i];

      // Deduplicate by date + amount + description
      const dup = await pool.query(
        `SELECT 1 FROM transactions
         WHERE account_id = $1 AND date = $2 AND amount = $3 AND description = $4
         LIMIT 1`,
        [targetAccountId, tx.date, tx.amount, tx.description],
      );

      if (dup.rows.length > 0) {
        skipped++;
        continue;
      }

      await pool.query(
        `INSERT INTO transactions (account_id, user_id, amount, date, description, category, subcategory, is_recurring, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'csv')`,
        [
          targetAccountId,
          req.user!.userId,
          tx.amount,
          tx.date,
          tx.description,
          cat.category,
          cat.subcategory,
          cat.isRecurring,
        ],
      );
      imported++;
    }

    // Update account balance based on transaction totals
    await updateAccountBalance(targetAccountId);

    res.json({
      imported,
      skipped,
      total: parsed.length,
      accountId: targetAccountId,
    });
  } catch (err) {
    console.error("CSV upload error:", err);
    if (err instanceof multer.MulterError) {
      res.status(400).json({ error: `Error de archivo: ${err.message}` });
    } else {
      res.status(500).json({ error: "Error procesando el archivo CSV" });
    }
  }
});

// GET /api/transactions — list transactions with pagination and filters
router.get("/", requireAuth, async (req, res) => {
  const limit = Math.min(100, parseInt(req.query.limit as string) || 50);
  const offset = parseInt(req.query.offset as string) || 0;
  const category = req.query.category as string;
  const dateFrom = req.query.dateFrom as string;
  const dateTo = req.query.dateTo as string;
  const accountId = req.query.accountId as string;

  try {
    let query = `SELECT t.*, a.name as account_name
                 FROM transactions t
                 JOIN accounts a ON t.account_id = a.id
                 WHERE t.user_id = $1`;
    const params: unknown[] = [req.user!.userId];
    let paramIdx = 2;

    if (category) {
      query += ` AND t.category = $${paramIdx++}`;
      params.push(category);
    }
    if (dateFrom) {
      query += ` AND t.date >= $${paramIdx++}`;
      params.push(dateFrom);
    }
    if (dateTo) {
      query += ` AND t.date <= $${paramIdx++}`;
      params.push(dateTo);
    }
    if (accountId) {
      query += ` AND t.account_id = $${paramIdx++}`;
      params.push(accountId);
    }

    query += ` ORDER BY t.date DESC, t.created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
    params.push(limit, offset);

    const result = await pool.query<TransactionRow & { account_name: string }>(query, params);

    // Get total count for pagination
    let countQuery = `SELECT COUNT(*) as total FROM transactions WHERE user_id = $1`;
    const countParams: unknown[] = [req.user!.userId];
    let countIdx = 2;

    if (category) {
      countQuery += ` AND category = $${countIdx++}`;
      countParams.push(category);
    }
    if (dateFrom) {
      countQuery += ` AND date >= $${countIdx++}`;
      countParams.push(dateFrom);
    }
    if (dateTo) {
      countQuery += ` AND date <= $${countIdx++}`;
      countParams.push(dateTo);
    }
    if (accountId) {
      countQuery += ` AND account_id = $${countIdx++}`;
      countParams.push(accountId);
    }

    const countResult = await pool.query<{ total: string }>(countQuery, countParams);

    res.json({
      transactions: result.rows,
      total: Number(countResult.rows[0].total),
      limit,
      offset,
    });
  } catch (err) {
    console.error("List transactions error:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// PATCH /api/transactions/:id/category — user corrects a category
router.patch("/:id/category", requireAuth, async (req, res) => {
  const { category, subcategory } = req.body;

  if (!category) {
    res.status(400).json({ error: "Se requiere la categoría" });
    return;
  }

  try {
    const result = await pool.query<TransactionRow>(
      `UPDATE transactions
       SET category = $1, subcategory = $2
       WHERE id = $3 AND user_id = $4
       RETURNING *`,
      [category, subcategory || "", req.params.id, req.user!.userId],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Transacción no encontrada" });
      return;
    }

    res.json({ transaction: result.rows[0] });
  } catch (err) {
    console.error("Update category error:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// GET /api/transactions/summary — spending breakdown by category for a period
router.get("/summary", requireAuth, async (req, res) => {
  const dateFrom = (req.query.dateFrom as string) || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];
  const dateTo = (req.query.dateTo as string) || new Date().toISOString().split("T")[0];

  try {
    const spending = await pool.query<{ category: string; total: string; count: string }>(
      `SELECT category, COALESCE(SUM(ABS(amount)), 0) as total, COUNT(*) as count
       FROM transactions
       WHERE user_id = $1 AND amount < 0 AND date >= $2 AND date <= $3
       GROUP BY category ORDER BY total DESC`,
      [req.user!.userId, dateFrom, dateTo],
    );

    const income = await pool.query<{ total: string; count: string }>(
      `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
       FROM transactions
       WHERE user_id = $1 AND amount > 0 AND date >= $2 AND date <= $3`,
      [req.user!.userId, dateFrom, dateTo],
    );

    const totalSpent = spending.rows.reduce((sum, r) => sum + Number(r.total), 0);

    res.json({
      dateFrom,
      dateTo,
      spending: spending.rows.map((r) => ({
        category: r.category || "Sin categoría",
        total: Number(r.total),
        count: Number(r.count),
        percentage: totalSpent > 0 ? Math.round((Number(r.total) / totalSpent) * 100) : 0,
      })),
      totalSpent,
      totalIncome: Number(income.rows[0].total),
      incomeCount: Number(income.rows[0].count),
    });
  } catch (err) {
    console.error("Summary error:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// --- CSV parser ---

function parseCsv(text: string): CsvTransactionInput[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return []; // Need at least header + 1 row

  const header = lines[0].toLowerCase();
  const columns = splitCsvLine(header);

  // Find column indices — flexible matching for Mexican bank CSVs
  const dateIdx = columns.findIndex((c) => /fecha|date/.test(c));
  const descIdx = columns.findIndex((c) => /descripci[oó]n|concepto|description|detalle|referencia/.test(c));
  const amountIdx = columns.findIndex((c) => /monto|importe|amount|cargo|abono|cantidad/.test(c));
  const depositIdx = columns.findIndex((c) => /abono|dep[oó]sito|ingreso|cr[eé]dito/.test(c));
  const chargeIdx = columns.findIndex((c) => /cargo|retiro|d[eé]bito|egreso/.test(c));

  if (dateIdx === -1) return []; // Date column required
  if (descIdx === -1 && amountIdx === -1) return []; // Need at least description or amount

  const transactions: CsvTransactionInput[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = splitCsvLine(line);

    const dateStr = cols[dateIdx]?.trim();
    if (!dateStr) continue;

    const date = parseDate(dateStr);
    if (!date) continue;

    const description = descIdx >= 0 ? (cols[descIdx]?.trim() || "") : "";

    let amount: number;
    if (amountIdx >= 0) {
      amount = parseMxnAmount(cols[amountIdx]);
    } else if (depositIdx >= 0 && chargeIdx >= 0) {
      // Separate deposit/charge columns (common in Mexican bank exports)
      const deposit = parseMxnAmount(cols[depositIdx]);
      const charge = parseMxnAmount(cols[chargeIdx]);
      amount = deposit > 0 ? deposit : -charge;
    } else {
      continue;
    }

    if (amount === 0) continue;

    transactions.push({ date, description, amount });
  }

  return transactions;
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function parseDate(dateStr: string): string | null {
  // Try common Mexican date formats
  // DD/MM/YYYY
  let match = dateStr.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (match) {
    const [, day, month, year] = match;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  // YYYY-MM-DD (ISO)
  match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }
  // YYYY/MM/DD
  match = dateStr.match(/^(\d{4})[/.](\d{2})[/.](\d{2})$/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }
  return null;
}

function parseMxnAmount(raw: string | undefined): number {
  if (!raw) return 0;
  // Remove MXN currency symbols, thousand separators, and whitespace
  const cleaned = raw.replace(/[$MXN\s]/gi, "").replace(/,/g, "").trim();
  if (!cleaned) return 0;
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

async function updateAccountBalance(accountId: string): Promise<void> {
  await pool.query(
    `UPDATE accounts SET balance = (
       SELECT COALESCE(SUM(amount), 0)
       FROM transactions WHERE account_id = $1
     ) WHERE id = $1`,
    [accountId],
  );
}

export default router;
