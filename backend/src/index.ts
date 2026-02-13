import express from "express";
import cors from "cors";
import { config } from "./config.js";
import healthRouter from "./routes/health.js";
import authRouter from "./routes/auth.js";
import chatRouter from "./routes/chat.js";
import financeRouter from "./routes/finance.js";
import bankRouter from "./routes/bank.js";
import transactionsRouter from "./routes/transactions.js";

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.use("/api", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/chat", chatRouter);
app.use("/api/finance", financeRouter);
app.use("/api/bank", bankRouter);
app.use("/api/transactions", transactionsRouter);

app.listen(config.port, () => {
  console.log(`Tío Richie API listening on port ${config.port}`);
});
