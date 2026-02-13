// Bank connection management — Finerio Connect integration + webhook handler

import { Router } from "express";
import { pool } from "../db/index.js";
import { config } from "../config.js";
import { requireAuth } from "../middleware/auth.js";
import * as finerio from "../services/finerio.js";
import type { BankConnectionRow, AccountRow } from "../types/index.js";

const router = Router();

// GET /api/bank/connections — list user's bank connections
router.get("/connections", requireAuth, async (req, res) => {
  try {
    const result = await pool.query<BankConnectionRow>(
      `SELECT id, institution_name, status, last_sync_at, created_at
       FROM bank_connections WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user!.userId],
    );
    res.json({ connections: result.rows });
  } catch (err) {
    console.error("List connections error:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// POST /api/bank/connect — initiate a new bank connection via Finerio
router.post("/connect", requireAuth, async (req, res) => {
  const { institutionId, institutionName } = req.body;

  if (!institutionId || !institutionName) {
    res.status(400).json({ error: "Se requiere institutionId e institutionName" });
    return;
  }

  try {
    // Create or get Finerio customer for this user
    const customerResult = await pool.query<{ finerio_customer_id: string }>(
      "SELECT id FROM users WHERE id = $1",
      [req.user!.userId],
    );
    if (customerResult.rows.length === 0) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }

    // Store the connection as pending — Finerio widget handles credential entry
    const result = await pool.query<BankConnectionRow>(
      `INSERT INTO bank_connections (user_id, institution_name, status)
       VALUES ($1, $2, 'pending')
       RETURNING id, institution_name, status, created_at`,
      [req.user!.userId, institutionName],
    );

    res.status(201).json({ connection: result.rows[0] });
  } catch (err) {
    console.error("Create connection error:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// POST /api/bank/webhook — Finerio sends updates here
router.post("/webhook", async (req, res) => {
  // Verify webhook signature
  const signature = req.headers["x-finerio-signature"];
  if (config.finerio.webhookSecret && signature !== config.finerio.webhookSecret) {
    res.status(401).json({ error: "Firma inválida" });
    return;
  }

  const { event, data } = req.body;

  try {
    switch (event) {
      case "credential.success": {
        // Finerio finished syncing a credential
        await handleCredentialSuccess(data);
        break;
      }
      case "credential.failure": {
        await handleCredentialFailure(data);
        break;
      }
      case "transactions.ready": {
        await handleTransactionsReady(data);
        break;
      }
      default:
        console.log(`Unhandled Finerio webhook event: ${event}`);
    }
    res.json({ received: true });
  } catch (err) {
    console.error("Webhook processing error:", err);
    res.status(500).json({ error: "Error procesando webhook" });
  }
});

// POST /api/bank/sync/:connectionId — trigger manual sync
router.post("/sync/:connectionId", requireAuth, async (req, res) => {
  try {
    const conn = await pool.query<BankConnectionRow>(
      "SELECT * FROM bank_connections WHERE id = $1 AND user_id = $2",
      [req.params.connectionId, req.user!.userId],
    );

    if (conn.rows.length === 0) {
      res.status(404).json({ error: "Conexión no encontrada" });
      return;
    }

    const connection = conn.rows[0];
    if (!connection.finerio_connection_id) {
      res.status(400).json({ error: "Conexión no vinculada con Finerio" });
      return;
    }

    // Fetch latest accounts and transactions from Finerio
    const credentialId = Number(connection.finerio_connection_id);
    await syncAccountsAndTransactions(req.user!.userId, connection.id, credentialId);

    // Update sync timestamp
    await pool.query(
      "UPDATE bank_connections SET last_sync_at = NOW(), status = 'active' WHERE id = $1",
      [connection.id],
    );

    res.json({ synced: true });
  } catch (err) {
    console.error("Manual sync error:", err);
    res.status(500).json({ error: "Error al sincronizar" });
  }
});

// DELETE /api/bank/connections/:id — remove a bank connection
router.delete("/connections/:id", requireAuth, async (req, res) => {
  try {
    const conn = await pool.query<BankConnectionRow>(
      "SELECT * FROM bank_connections WHERE id = $1 AND user_id = $2",
      [req.params.id, req.user!.userId],
    );

    if (conn.rows.length === 0) {
      res.status(404).json({ error: "Conexión no encontrada" });
      return;
    }

    // Delete from Finerio if linked
    const connection = conn.rows[0];
    if (connection.finerio_connection_id) {
      try {
        await finerio.deleteCredential(Number(connection.finerio_connection_id));
      } catch {
        // Finerio deletion failed — proceed with local cleanup
      }
    }

    // Cascade delete: accounts + transactions are handled by DB foreign keys
    await pool.query("DELETE FROM bank_connections WHERE id = $1", [connection.id]);

    res.json({ deleted: true });
  } catch (err) {
    console.error("Delete connection error:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// GET /api/bank/accounts — list all user accounts
router.get("/accounts", requireAuth, async (req, res) => {
  try {
    const result = await pool.query<AccountRow>(
      `SELECT a.id, a.account_type, a.name, a.balance, a.currency, a.bank_connection_id,
              bc.institution_name
       FROM accounts a
       LEFT JOIN bank_connections bc ON a.bank_connection_id = bc.id
       WHERE a.user_id = $1 ORDER BY a.created_at DESC`,
      [req.user!.userId],
    );
    res.json({ accounts: result.rows });
  } catch (err) {
    console.error("List accounts error:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// --- Webhook handlers ---

async function handleCredentialSuccess(data: {
  credentialId: number;
  customerId: string;
}) {
  // Link Finerio credential to our bank_connection
  // Find the pending connection for this user
  const conn = await pool.query<BankConnectionRow>(
    `UPDATE bank_connections
     SET finerio_connection_id = $1, status = 'active', last_sync_at = NOW()
     WHERE status = 'pending'
       AND user_id = (SELECT id FROM users LIMIT 1)
     RETURNING *`,
    [String(data.credentialId)],
  );

  if (conn.rows.length > 0) {
    const connection = conn.rows[0];
    await syncAccountsAndTransactions(
      connection.user_id,
      connection.id,
      data.credentialId,
    );
  }
}

async function handleCredentialFailure(data: {
  credentialId: number;
  error: string;
}) {
  await pool.query(
    `UPDATE bank_connections SET status = 'error'
     WHERE finerio_connection_id = $1 OR (status = 'pending')`,
    [String(data.credentialId)],
  );
}

async function handleTransactionsReady(data: {
  credentialId: number;
}) {
  const conn = await pool.query<BankConnectionRow>(
    "SELECT * FROM bank_connections WHERE finerio_connection_id = $1",
    [String(data.credentialId)],
  );

  if (conn.rows.length > 0) {
    const connection = conn.rows[0];
    await syncAccountsAndTransactions(
      connection.user_id,
      connection.id,
      data.credentialId,
    );
  }
}

// --- Sync logic ---

async function syncAccountsAndTransactions(
  userId: string,
  connectionId: string,
  finerioCredentialId: number,
) {
  // 1. Fetch accounts from Finerio
  const finerioAccounts = await finerio.getAccounts(finerioCredentialId);

  for (const fa of finerioAccounts) {
    const accountType = finerio.mapAccountType(fa.nature);

    // Upsert account
    const accountResult = await pool.query<AccountRow>(
      `INSERT INTO accounts (user_id, bank_connection_id, account_type, name, balance, currency)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [userId, connectionId, accountType, fa.name, fa.balance, fa.currency || "MXN"],
    );

    let accountId: string;
    if (accountResult.rows.length > 0) {
      accountId = accountResult.rows[0].id;
    } else {
      // Account already exists — update balance
      const existing = await pool.query<AccountRow>(
        "SELECT id FROM accounts WHERE user_id = $1 AND bank_connection_id = $2 AND name = $3",
        [userId, connectionId, fa.name],
      );
      if (existing.rows.length === 0) continue;
      accountId = existing.rows[0].id;
      await pool.query("UPDATE accounts SET balance = $1 WHERE id = $2", [fa.balance, accountId]);
    }

    // 2. Fetch transactions for this account
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const dateFrom = threeMonthsAgo.toISOString().split("T")[0];

    const finerioTxs = await finerio.getTransactions(fa.id, { dateFrom });

    for (const ftx of finerioTxs) {
      const mapped = finerio.mapTransaction(ftx);

      // Insert if not duplicate (check by date + amount + description)
      await pool.query(
        `INSERT INTO transactions (account_id, user_id, amount, date, description, category, subcategory, source)
         SELECT $1, $2, $3, $4, $5, $6, $7, 'finerio'
         WHERE NOT EXISTS (
           SELECT 1 FROM transactions
           WHERE account_id = $1 AND date = $4 AND amount = $3 AND description = $5
         )`,
        [accountId, userId, mapped.amount, mapped.date, mapped.description, mapped.category, mapped.subcategory],
      );
    }
  }

  // Update sync timestamp
  await pool.query(
    "UPDATE bank_connections SET last_sync_at = NOW() WHERE id = $1",
    [connectionId],
  );
}

export default router;
