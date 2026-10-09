import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { setupWorkspace } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";
import { Card, Field, Flash, inputClass } from "@/components/ui";
import { prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Buat workspace" };

async function SetupForm({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await connection();
  if ((await prisma.creator.count()) > 0) redirect("/login");
  const { error } = await searchParams;
  return (
    <Card title="Buat workspace" description="Satu workspace untuk satu kreator. Kata sandi ini hanya untuk dashboard — jangan gunakan kata sandi platform.">
      <Flash error={error} />
      <form action={setupWorkspace} className="space-y-4">
        <Field label="Nama kreator / workspace">
          <input name="displayName" required minLength={2} maxLength={80} className={inputClass} placeholder="mis. Studio Rani" />
        </Field>
        <Field label="Kata sandi dashboard" hint="Minimal 10 karakter.">
          <input name="password" type="password" required minLength={10} autoComplete="new-password" className={inputClass} />
        </Field>
        <SubmitButton>Buat workspace</SubmitButton>
      </form>
    </Card>
  );
}

export default function SetupPage(props: PageProps<"/setup">) {
  return (
    <Suspense>
      <SetupForm searchParams={props.searchParams as Promise<{ error?: string }>} />
    </Suspense>
  );
}
