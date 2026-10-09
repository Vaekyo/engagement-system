export type FlashParams = { ok?: string; error?: string };

export async function readFlash(searchParams: Promise<Record<string, string | string[] | undefined>>): Promise<FlashParams> {
  const sp = await searchParams;
  const pick = (v: string | string[] | undefined) => (typeof v === "string" ? v.slice(0, 300) : undefined);
  return { ok: pick(sp.ok), error: pick(sp.error) };
}
