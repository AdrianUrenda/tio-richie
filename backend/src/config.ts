function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const config = {
  port: parseInt(process.env["PORT"] ?? "3001", 10),
  nodeEnv: process.env["NODE_ENV"] ?? "development",
  database: {
    url: requireEnv("DATABASE_URL"),
  },
  jwt: {
    accessSecret: requireEnv("JWT_ACCESS_SECRET"),
    refreshSecret: requireEnv("JWT_REFRESH_SECRET"),
    accessExpiresIn: process.env["JWT_ACCESS_EXPIRES_IN"] ?? "15m",
    refreshExpiresIn: process.env["JWT_REFRESH_EXPIRES_IN"] ?? "30d",
  },
  anthropic: {
    apiKey: requireEnv("ANTHROPIC_API_KEY"),
    model: process.env["ANTHROPIC_MODEL"] ?? "claude-sonnet-4-20250514",
  },
};
