import type { Metadata } from "next";
import { Lockup } from "@/components/Logo";

export const metadata: Metadata = { title: "Настройка" };

/** Shown while the Supabase keys are missing from the environment. */
export default function SetupPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-forest p-5">
      <div className="w-full max-w-lg rounded-3xl bg-ivory p-8">
        <Lockup onDark={false} width={112} />
        <h1 className="mt-4 font-serif text-3xl text-forest">База данных не подключена</h1>
        <p className="mt-3 text-muted">
          Панель заработает после того, как будет создан проект Supabase и его ключи добавлены в настройки сайта:
        </p>
        <ul className="mt-4 grid gap-2 font-mono text-sm text-graphite">
          <li>NEXT_PUBLIC_SUPABASE_URL</li>
          <li>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</li>
        </ul>
        <p className="mt-4 text-sm text-muted">Подробности — в README проекта, раздел «Supabase».</p>
      </div>
    </main>
  );
}
