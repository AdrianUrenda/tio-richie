import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import { testConnection } from "./db.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { chatRoutes } from "./routes/chat.js";

async function main(): Promise<void> {
  const app = Fastify({
    logger: {
      level: config.nodeEnv === "development" ? "info" : "warn",
    },
  });

  await app.register(cors, {
    origin: config.nodeEnv === "development" ? true : false,
    credentials: true,
  });

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(chatRoutes);

  try {
    await testConnection();
    await app.listen({ port: config.port, host: "0.0.0.0" });
    console.log(`Server running on http://localhost:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
