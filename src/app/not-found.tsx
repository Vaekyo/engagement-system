import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 px-4 text-center">
      <p className="text-lg font-semibold">Halaman tidak ditemukan</p>
      <Link href="/" className="text-sm text-accent underline">
        Kembali ke ringkasan
      </Link>
    </main>
  );
}
