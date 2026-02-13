"use client";

import { useEffect } from "react";

export default function HomePage() {
  useEffect(() => {
    const token = localStorage.getItem("token");
    window.location.href = token ? "/chat" : "/login";
  }, []);

  return (
    <div className="flex h-dvh items-center justify-center">
      <p className="text-gray-400">Cargando...</p>
    </div>
  );
}
