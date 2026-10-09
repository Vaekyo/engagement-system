import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { login } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";
import { Card, Field, Flash, inputClass } from "@/components/ui";
import { prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Masuk" };

async function LoginForm({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await connection();
  const creator = await prisma.creator.findFirst({ select: { displayName: true } });
  if (!creator) redirect("/setup");
  const { error } = await searchParams;
  return (
    <Card title={`Masuk ke ${creator.displayName}`}>
      <Flash error={error} />
      <form action={login} className="space-y-4">
        <Field label="Kata sandi dashboard">
          <input name="password" type="password" required autoComplete="current-password" className={inputClass} autoFocus />
        </Field>
        <SubmitButton>Masuk</SubmitButton>
      </form>
    </Card>
  );
}

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <Suspense>
      <LoginForm searchParams={props.searchParams as Promise<{ error?: string }>} />
    </Suspense>
  );
}
