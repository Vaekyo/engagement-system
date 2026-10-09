import type { DraftStatus } from "@prisma/client";

// Draft lifecycle (blueprint 5.4):
//   draft → pending_approval → approved → queued → published
// plus rejected, failed, manual_action_required and cancelled.
const TRANSITIONS: Record<DraftStatus, readonly DraftStatus[]> = {
  draft: ["pending_approval", "rejected", "cancelled"],
  pending_approval: ["approved", "rejected", "draft", "cancelled"],
  // Approval is the only gate into publishing; nothing skips it.
  approved: ["queued", "manual_action_required", "cancelled"],
  queued: ["published", "failed", "manual_action_required", "cancelled"],
  failed: ["queued", "manual_action_required", "cancelled"],
  manual_action_required: ["published", "cancelled"],
  rejected: ["draft"],
  published: [],
  cancelled: [],
};

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: DraftStatus,
    readonly to: DraftStatus,
  ) {
    super(`Draft cannot move from ${from} to ${to}`);
  }
}

export function canTransition(from: DraftStatus, to: DraftStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: DraftStatus, to: DraftStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export const EDITABLE_STATUSES: readonly DraftStatus[] = ["draft", "pending_approval"];

export const STATUS_LABELS: Record<DraftStatus, string> = {
  draft: "Draf",
  pending_approval: "Menunggu persetujuan",
  approved: "Disetujui",
  queued: "Dalam antrean",
  published: "Terpublikasi",
  rejected: "Ditolak",
  failed: "Gagal",
  manual_action_required: "Perlu posting manual",
  cancelled: "Dibatalkan",
};
