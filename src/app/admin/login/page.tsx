import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Вход" };

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-forest p-5">
      <div className="w-full max-w-sm rounded-3xl bg-ivory p-8">
        <Logo className="text-2xl" />
        <p className="label mt-1 text-muted">Панель управления</p>
        <LoginForm />
      </div>
    </main>
  );
}
