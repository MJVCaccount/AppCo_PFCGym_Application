import "server-only";

import { listLatest } from "@/lib/repositories/auditRepository";
import {
  ADMIN_ONLY,
  fail,
  failure,
  isAdmin,
  succeed,
} from "@/lib/services/serviceResult";
import type { AuditLogRow, ServiceResult, SessionUser } from "@/lib/types";

const AUDIT_ROWS = 100;

/** The latest 100 audit rows, newest first. Admin only, read only. */
export async function listAuditLog(
  session: SessionUser,
): Promise<ServiceResult<AuditLogRow[]>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);

  try {
    return succeed(await listLatest(AUDIT_ROWS));
  } catch (e) {
    return failure(e);
  }
}
