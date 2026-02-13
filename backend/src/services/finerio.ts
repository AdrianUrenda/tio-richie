// Finerio Connect API client (PRD section 11.2)
// Tío Richie never stores bank credentials — Finerio handles tokenized access.

import { config } from "../config.js";
import type { FinerioCredential, FinerioAccount, FinerioTransaction } from "../types/index.js";

const BASE_URL = config.finerio.apiUrl;
const API_KEY = config.finerio.apiKey;

async function finerioFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Finerio API error ${res.status}: ${body}`);
  }

  return res.json() as Promise<T>;
}

// --- Credential (bank connection) management ---

export async function createCredential(
  customerId: string,
  institutionId: number,
  username: string,
  password: string,
): Promise<FinerioCredential> {
  return finerioFetch<FinerioCredential>("/credentials", {
    method: "POST",
    body: JSON.stringify({ customerId, institutionId, username, password }),
  });
}

export async function getCredential(credentialId: number): Promise<FinerioCredential> {
  return finerioFetch<FinerioCredential>(`/credentials/${credentialId}`);
}

export async function deleteCredential(credentialId: number): Promise<void> {
  await finerioFetch(`/credentials/${credentialId}`, { method: "DELETE" });
}

// --- Customer management ---

export async function createCustomer(name: string): Promise<{ id: number }> {
  return finerioFetch<{ id: number }>("/customers", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

// --- Account retrieval ---

export async function getAccounts(credentialId: number): Promise<FinerioAccount[]> {
  return finerioFetch<FinerioAccount[]>(`/credentials/${credentialId}/accounts`);
}

// --- Transaction retrieval ---

export async function getTransactions(
  accountId: number,
  params?: { dateFrom?: string; dateTo?: string },
): Promise<FinerioTransaction[]> {
  const query = new URLSearchParams();
  if (params?.dateFrom) query.set("dateFrom", params.dateFrom);
  if (params?.dateTo) query.set("dateTo", params.dateTo);
  const qs = query.toString();
  return finerioFetch<FinerioTransaction[]>(`/accounts/${accountId}/transactions${qs ? `?${qs}` : ""}`);
}

// --- Map Finerio types to our DB schema ---

export function mapAccountType(nature: string): string {
  const mapping: Record<string, string> = {
    Checking: "checking",
    "Credit Card": "credit",
    Savings: "savings",
    Investment: "investment",
    Loan: "loan",
    Mortgage: "mortgage",
  };
  return mapping[nature] || "other";
}

export function mapTransaction(tx: FinerioTransaction): {
  amount: number;
  date: string;
  description: string;
  category: string;
  subcategory: string;
} {
  return {
    amount: tx.charge ? -Math.abs(tx.amount) : Math.abs(tx.amount),
    date: tx.date,
    description: tx.description,
    category: tx.category?.parentCategory?.name || tx.category?.name || "Sin categoría",
    subcategory: tx.category?.name || "",
  };
}
