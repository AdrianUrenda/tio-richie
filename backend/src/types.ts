// Database row types (match SQL schema)

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  subscription_status: "trial" | "active" | "canceled" | "expired";
  trial_end_date: Date;
  notification_prefs: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  created_at: Date;
}

// API request/response types

export interface RegisterBody {
  email: string;
  name: string;
  password: string;
}

export interface LoginBody {
  email: string;
  password: string;
}

export interface RefreshBody {
  refreshToken: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface UserPublic {
  id: string;
  email: string;
  name: string;
  subscriptionStatus: string;
  trialEndDate: string;
  createdAt: string;
}

// Chat types

export interface ConversationRow {
  id: string;
  user_id: string;
  messages: ConversationMessage[];
  token_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface ChatMessageBody {
  message: string;
  conversationId?: string;
}

export interface SafeToSpendResponse {
  amount: number | null;
  label: string;
  hasFinancialData: boolean;
}

// JWT payload

export interface JwtAccessPayload {
  sub: string;
  email: string;
}
