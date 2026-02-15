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

// --- Push subscriptions ---

export interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  keys_p256dh: string;
  keys_auth: string;
  user_agent: string | null;
  created_at: string;
}

// --- Notifications ---

export interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  content: string;
  metadata: Record<string, unknown>;
  sent_at: string | null;
  opened_at: string | null;
  status: string;
  created_at: string;
}

export type NotificationType =
  | "spending_alert"
  | "debt_payment_reminder"
  | "quincena_checkin";

// --- Debt analysis ---

export interface DebtInfo {
  goalId: string;
  name: string;
  currentBalance: number;
  interestRate: number; // annual decimal, e.g. 0.365 for 36.5%
  minimumPayment: number;
  paymentDueDay: number;
}

export interface DebtMilestone {
  month: number;
  balance: number;
  interestPaid: number;
  cumulativeInterest: number;
}

export interface DebtPayoffDetail {
  name: string;
  goalId: string;
  payoffOrder: number;
  monthsToPayoff: number;
  totalInterestPaid: number;
  totalPaid: number;
  milestones: DebtMilestone[];
}

export interface DebtPayoffStrategy {
  method: "avalanche" | "snowball";
  debts: DebtPayoffDetail[];
  totalMonths: number;
  totalInterestPaid: number;
  totalPaid: number;
  monthlyPayment: number;
}

export interface DebtComparisonResult {
  avalanche: DebtPayoffStrategy;
  snowball: DebtPayoffStrategy;
  interestSaved: number;
  timeDifference: number;
}

export interface DetectedDebt {
  accountId: string;
  accountName: string;
  currentBalance: number;
  estimatedInterestRate: number | null;
  estimatedMinimumPayment: number | null;
  confidence: "high" | "low";
}

// --- Goal row (extended with debt fields) ---

export interface GoalRow {
  id: string;
  user_id: string;
  type: string;
  target_amount: string | null;
  current_amount: string;
  deadline: string | null;
  strategy: string | null;
  status: string;
  priority: number;
  interest_rate: string | null;
  minimum_payment: string | null;
  current_balance: string | null;
  payment_due_day: number | null;
  debt_account_id: string | null;
  milestones: DebtMilestone[];
  created_at: string;
  updated_at: string;
}
