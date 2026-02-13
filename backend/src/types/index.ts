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

// --- Bank / Finerio types ---

export interface BankConnectionRow {
  id: string;
  user_id: string;
  finerio_connection_id: string | null;
  institution_name: string;
  status: string;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountRow {
  id: string;
  user_id: string;
  bank_connection_id: string | null;
  account_type: string;
  name: string;
  balance: string; // DECIMAL comes as string from pg
  currency: string;
  created_at: string;
  updated_at: string;
}

export interface TransactionRow {
  id: string;
  account_id: string;
  user_id: string;
  amount: string;
  date: string;
  description: string | null;
  category: string | null;
  subcategory: string | null;
  is_recurring: boolean;
  source: string;
  created_at: string;
}

// --- Finerio Connect API responses ---

export interface FinerioCredential {
  id: number;
  username: string;
  status: string;
  institution: { id: number; name: string; code: string };
}

export interface FinerioAccount {
  id: number;
  name: string;
  nature: string; // "Checking", "Credit Card", "Savings"
  balance: number;
  currency: string;
}

export interface FinerioTransaction {
  id: number;
  description: string;
  amount: number;
  date: string;
  charge: boolean; // true = expense, false = income/deposit
  category: { id: number; name: string; parentCategory?: { name: string } };
}

// --- CSV upload ---

export interface CsvTransactionInput {
  date: string;
  description: string;
  amount: number;
}

// --- Financial engine ---

export interface QuincenaPeriod {
  start: Date;
  end: Date;
  remainingDays: number;
}

export interface SafeToSpendResult {
  safeToSpend: number;
  currency: string;
  remainingDays: number;
  periodStart: string;
  periodEnd: string;
  disposableIncome: number;
  spentThisPeriod: number;
  committedExpenses: number;
  goalContributions: number;
  totalBalance: number;
  hasData: boolean;
}

export interface CategoryResult {
  category: string;
  subcategory: string;
  isRecurring: boolean;
  isIncome: boolean;
}
