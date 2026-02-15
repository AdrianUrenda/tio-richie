import express from "express";
import cors from "cors";
import { config } from "./config.js";
import healthRouter from "./routes/health.js";
import authRouter from "./routes/auth.js";
import chatRouter from "./routes/chat.js";
import financeRouter from "./routes/finance.js";
import bankRouter from "./routes/bank.js";
import transactionsRouter from "./routes/transactions.js";
import notificationsRouter from "./routes/notifications.js";
import debtRouter from "./routes/debt.js";
import { startNotificationMonitor } from "./services/notification-monitor.js";

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.use("/api", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/chat", chatRouter);
app.use("/api/finance", financeRouter);
app.use("/api/bank", bankRouter);
app.use("/api/transactions", transactionsRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/debt", debtRouter);

app.listen(config.port, () => {
  console.log(`Tío Richie API listening on port ${config.port}`);
  startNotificationMonitor();
});
