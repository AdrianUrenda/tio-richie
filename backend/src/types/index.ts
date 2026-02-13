export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  subscription_status: string;
  trial_end_date: string | null;
  notification_prefs: Record<string, boolean>;
  created_at: string;
  updated_at: string;
}

export interface JwtPayload {
  userId: string;
  email: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface ConversationRow {
  id: string;
  user_id: string;
  messages: ChatMessage[];
  token_count: number;
  created_at: string;
  updated_at: string;
}
