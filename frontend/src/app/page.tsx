"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

interface User {
  id: string;
  email: string;
  name: string;
  subscription_status: string;
  trial_end_date: string | null;
  created_at: string;
}

export default function HomePage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      window.location.href = "/login";
      return;
    }
    apiFetch<{ user: User }>("/api/auth/me", { token })
      .then((data) => setUser(data.user))
      .catch(() => {
        localStorage.removeItem("token");
        window.location.href = "/login";
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Cargando...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6">
      <h1 className="mb-2 text-3xl font-bold">Hola, {user?.name} 👋</h1>
      <p className="mb-6 text-gray-500">
        Estado: {user?.subscription_status} &middot; Chat próximamente
      </p>
      <button
        onClick={() => {
          localStorage.removeItem("token");
          window.location.href = "/login";
        }}
        className="rounded-lg bg-gray-200 px-4 py-2 text-sm hover:bg-gray-300"
      >
        Cerrar sesión
      </button>
    </div>
  );
}
