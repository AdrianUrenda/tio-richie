import express from "express";
import cors from "cors";
import { config } from "./config.js";
import healthRouter from "./routes/health.js";
import authRouter from "./routes/auth.js";

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.use("/api", healthRouter);
app.use("/api/auth", authRouter);

app.listen(config.port, () => {
  console.log(`Tío Richie API listening on port ${config.port}`);
});
