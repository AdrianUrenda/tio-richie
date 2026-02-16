import Link from "next/link";
import FeatureCard from "@/components/FeatureCard";

const features = [
  {
    icon: "\u{1F916}",
    title: "Coach financiero con IA",
    description:
      "Platica con Tío Richie como si fuera tu tío experto en finanzas. Te da consejos personalizados basados en tus hábitos reales.",
  },
  {
    icon: "\u{1F3E6}",
    title: "Conexión con tu banco",
    description:
      "Conecta tus cuentas bancarias de forma segura. Tío Richie analiza tus movimientos para darte recomendaciones certeras.",
  },
  {
    icon: "\u{1F9E0}",
    title: "Insights conductuales",
    description:
      "Descubre los sesgos que afectan tus decisiones financieras. Aprende a gastar con intención y ahorrar sin sufrir.",
  },
  {
    icon: "\u{1F4B0}",
    title: "Precio accesible",
    description:
      "Por solo $99 MXN al mes, ten acceso ilimitado a tu coach financiero personal. Empieza con 30 días gratis.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-green-50 to-white">
      {/* Hero */}
      <section className="flex flex-col items-center justify-center px-4 pt-24 pb-16 text-center sm:pt-32 sm:pb-20">
        <h1 className="text-5xl font-bold tracking-tight text-gray-900 sm:text-6xl">
          Tío Richie
        </h1>
        <p className="mt-4 max-w-xl text-xl text-gray-600">
          Tu coach de finanzas personales impulsado por inteligencia artificial.
          Toma el control de tu dinero con consejos personalizados.
        </p>
        <Link
          href="/chat"
          className="mt-8 inline-block rounded-full bg-green-600 px-8 py-3 text-lg font-semibold text-white shadow-lg transition-colors hover:bg-green-700"
        >
          Comenzar gratis
        </Link>
        <p className="mt-3 text-sm text-gray-500">
          30 días de prueba gratis. Sin tarjeta de crédito.
        </p>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-5xl px-4 py-16 sm:py-20">
        <h2 className="mb-12 text-center text-3xl font-bold text-gray-900">
          ¿Cómo te ayuda Tío Richie?
        </h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <FeatureCard key={feature.title} {...feature} />
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="bg-green-50 px-4 py-16 sm:py-20">
        <div className="mx-auto max-w-md text-center">
          <h2 className="mb-4 text-3xl font-bold text-gray-900">
            Simple y accesible
          </h2>
          <div className="rounded-2xl border border-green-200 bg-white p-8 shadow-sm">
            <p className="text-5xl font-bold text-green-600">$99</p>
            <p className="mt-1 text-gray-500">MXN / mes</p>
            <ul className="mt-6 space-y-2 text-left text-gray-600">
              <li className="flex items-center gap-2">
                <span className="text-green-600">&#10003;</span> Chat ilimitado con tu coach IA
              </li>
              <li className="flex items-center gap-2">
                <span className="text-green-600">&#10003;</span> Conexión bancaria segura
              </li>
              <li className="flex items-center gap-2">
                <span className="text-green-600">&#10003;</span> Análisis de hábitos financieros
              </li>
              <li className="flex items-center gap-2">
                <span className="text-green-600">&#10003;</span> 30 días gratis para probar
              </li>
            </ul>
            <Link
              href="/chat"
              className="mt-8 inline-block w-full rounded-full bg-green-600 py-3 text-center font-semibold text-white transition-colors hover:bg-green-700"
            >
              Empezar prueba gratis
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-4 py-8 text-center text-sm text-gray-400">
        &copy; 2025 Tío Richie. Todos los derechos reservados.
      </footer>
    </main>
  );
}
