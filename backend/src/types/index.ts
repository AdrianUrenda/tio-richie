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
