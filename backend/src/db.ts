import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.database.url,
});

pool.on("error", (err) => {
  console.error("Unexpected database pool error:", err);
  process.exit(1);
});

export async function testConnection(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT 1");
    console.log("Database connection verified");
  } finally {
    client.release();
  }
}
