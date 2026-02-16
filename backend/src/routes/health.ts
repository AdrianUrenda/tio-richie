import { FastifyInstance } from "fastify";
import { pool } from "../db.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/health", async (_request, reply) => {
    try {
      await pool.query("SELECT 1");
      return reply.send({
        status: "ok",
        timestamp: new Date().toISOString(),
        database: "connected",
      });
    } catch {
      return reply.code(503).send({
        status: "error",
        timestamp: new Date().toISOString(),
        database: "disconnected",
      });
    }
  });
}
