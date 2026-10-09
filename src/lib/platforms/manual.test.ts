import { describe, expect, it } from "vitest";
import { instagramAdapter, tiktokAdapter } from "./manual";

describe("manual adapters", () => {
  it("report permission_required / unsupported instead of pretending to succeed", async () => {
    const ig = instagramAdapter();
    const tt = tiktokAdapter();
    expect(await ig.publishComment()).toMatchObject({ ok: false, status: "permission_required" });
    expect(await ig.listComments()).toMatchObject({ ok: false, status: "permission_required" });
    expect(await tt.publishComment()).toMatchObject({ ok: false, status: "unsupported" });
    expect(await tt.replyToComment()).toMatchObject({ ok: false, status: "unsupported" });
    expect(Object.values(tt.capabilities).every((v) => v === false)).toBe(true);
    expect((await ig.getConnectionStatus()).status).toBe("permission_required");
  });
});
