import { prisma } from "@/lib/prisma";

export type AuditEvent =
  | "login_success"
  | "login_failure"
  | "register"
  | "password_change"
  | "username_change"
  | "account_delete"
  | "recover_success"
  | "recover_failure"
  | "rate_limit_exceeded"
  | "api_token_issued";

export function audit(
  event: AuditEvent,
  opts: { userId?: string; ip?: string; detail?: string } = {},
): void {
  // Fire-and-forget — audit failure must never break the request path
  prisma.auditLog
    .create({ data: { event, userId: opts.userId ?? null, ip: opts.ip ?? null, detail: opts.detail ?? null } })
    .catch(() => {});
}
