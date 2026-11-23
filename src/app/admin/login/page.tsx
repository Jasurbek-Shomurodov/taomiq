import type { Metadata } from "next";
import { Lockup } from "@/components/Logo";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Вход" };

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-forest p-5">
      <div className="w-full max-w-sm rounded-3xl bg-ivory p-8">
        <div className="flex flex-col items-center text-center">
          <Lockup onDark={false} width={132} />
          <p className="label mt-4 text-muted">Панель управления</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
