import type { Metadata } from "next";
import Link from "next/link";

import { demoteFighterAction } from "@/actions/admin";
import { requireRole } from "@/actions/auth";
import ConfirmBar from "@/components/admin/ConfirmBar";
import Notices from "@/components/admin/Notices";
import PromoteForm from "@/components/admin/PromoteForm";
import Alert from "@/components/Alert";
import { listFightersForAdmin } from "@/lib/services/fighterService";
import { listPromotableMembers } from "@/lib/services/memberAdminService";
import { firstParam, formatRecord, type SearchParams } from "@/lib/types";

export const metadata: Metadata = { title: "Admin · Fighters" };
export const dynamic = "force-dynamic";

const BLOCKED =
  "Has bout offers or documents, so cannot be demoted. Their history stays on record.";

export default async function AdminFightersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const session = await requireRole("/admin/fighters", "Admin");

  const demoteId = Number(firstParam(params.demote));

  const [fighters, promotable] = await Promise.all([
    listFightersForAdmin(session),
    listPromotableMembers(session),
  ]);
  const rows = fighters.data ?? [];
  const target = rows.find((f) => f.id === demoteId && f.canDemote);

  return (
    <>
      <div className="section-head">
        <p className="eyebrow">Admin</p>
        <h2>Fighters</h2>
        <p className="lead">Members who compete. Their record follows the results you enter.</p>
      </div>

      <Notices notice={firstParam(params.notice)} error={firstParam(params.error)} />
      {!fighters.ok && <Alert kind="err">{fighters.error ?? "Fighters could not be loaded."}</Alert>}

      {target && (
        <ConfirmBar
          message={`Demote ${target.fullName} back to a regular member? Their membership is kept.`}
          action={demoteFighterAction}
          fields={{ id: target.id }}
          confirmLabel="Demote fighter"
          cancelHref="/admin/fighters"
        />
      )}

      <section className="admin-section" aria-labelledby="fighters-heading">
        <h3 id="fighters-heading">All fighters</h3>
        <div className="table-wrap">
          <table className="admin-table">
            <caption className="sr-only">Fighters</caption>
            <thead>
              <tr>
                <th scope="col">Fighter</th>
                <th scope="col">Weight class</th>
                <th scope="col">Record (W-L-D)</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No fighters yet.
                  </td>
                </tr>
              )}
              {rows.map((f) => (
                <tr key={f.id}>
                  <td>{f.fullName}</td>
                  <td>{f.weightClass}</td>
                  <td>{formatRecord(f)}</td>
                  <td>
                    {f.canDemote ? (
                      <Link
                        className="btn btn--line btn--sm"
                        href={`/admin/fighters?demote=${f.id}`}
                        scroll={false}
                        aria-label={`Demote ${f.fullName}`}
                      >
                        Demote
                      </Link>
                    ) : (
                      <div className="admin-actions">
                        <button
                          className="btn btn--line btn--sm"
                          type="button"
                          disabled
                          aria-describedby={`blocked-${f.id}`}
                          title={BLOCKED}
                          aria-label={`Demote ${f.fullName} (not available)`}
                        >
                          Demote
                        </button>
                        <span className="muted" id={`blocked-${f.id}`}>
                          {BLOCKED}
                        </span>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="admin-card">
        <h3>Promote a member to fighter</h3>
        {(promotable.data ?? []).length === 0 ? (
          <p className="lead">Every active member is already a fighter.</p>
        ) : (
          <PromoteForm members={promotable.data ?? []} />
        )}
      </div>
    </>
  );
}
