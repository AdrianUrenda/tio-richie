export const config = {
  port: parseInt(process.env.PORT || "4000", 10),
  databaseUrl: process.env.DATABASE_URL || "postgresql://tiorichie:tiorichie_dev@localhost:5432/tiorichie",
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  jwtSecret: process.env.JWT_SECRET || "change-me-in-production",
  jwtExpiresIn: 7 * 24 * 60 * 60, // 7 days in seconds
  bcryptRounds: 12,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  finerio: {
    apiUrl: process.env.FINERIO_API_URL || "https://api.finerio.mx/v2",
    apiKey: process.env.FINERIO_API_KEY || "",
    webhookSecret: process.env.FINERIO_WEBHOOK_SECRET || "",
  },
  maxCsvSizeMb: 5,
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || "",
    privateKey: process.env.VAPID_PRIVATE_KEY || "",
    subject: process.env.VAPID_SUBJECT || "mailto:soporte@tiorichie.com",
  },
};
