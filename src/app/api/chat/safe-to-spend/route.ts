import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { authenticateRequest } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (authResult instanceof NextResponse) return authResult;

    const userId = authResult.sub;

    const accountsResult = await pool.query(
      "SELECT COUNT(*) as count FROM accounts WHERE user_id = $1",
      [userId],
    );

    const hasData = parseInt(accountsResult.rows[0].count, 10) > 0;

    if (!hasData) {
      return NextResponse.json({
        amount: null,
        label: "Conecta tu banco para ver cuánto puedes gastar hoy",
        hasFinancialData: false,
      });
    }

    const balanceResult = await pool.query(
      `SELECT COALESCE(SUM(balance), 0) as total
       FROM accounts WHERE user_id = $1 AND account_type IN ('checking', 'savings')`,
      [userId],
    );

    const totalBalance = parseFloat(balanceResult.rows[0].total);
    const today = new Date();
    const daysInMonth = new Date(
      today.getFullYear(),
      today.getMonth() + 1,
      0,
    ).getDate();
    const remainingDays = daysInMonth - today.getDate() + 1;
    const safeToSpend =
      Math.round((totalBalance / remainingDays) * 100) / 100;

    return NextResponse.json({
      amount: safeToSpend,
      label: `Hoy puedes gastar: $${safeToSpend.toLocaleString("es-MX")} MXN`,
      hasFinancialData: true,
    });
  } catch (err) {
    console.error("Safe-to-spend error:", err);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 },
    );
  }
}
