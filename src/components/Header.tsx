import Link from "next/link";

export default function Header() {
  return (
    <header className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
      <Link
        href="/"
        className="text-green-600 hover:text-green-700"
        aria-label="Volver al inicio"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          className="h-5 w-5"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15.75 19.5 8.25 12l7.5-7.5"
          />
        </svg>
      </Link>
      <div>
        <h1 className="text-lg font-bold text-gray-900">Tío Richie</h1>
        <p className="text-xs text-gray-500">Tu coach financiero</p>
      </div>
    </header>
  );
}
