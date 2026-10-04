import type { Metadata } from "next";
import Link from "next/link";

import {
  deactivateUserAction,
  reactivateUserAction,
  setMemberPlanAction,
} from "@/actions/admin";
import { requireRole } from "@/actions/auth";
import ConfirmBar from "@/components/admin/ConfirmBar";
import Notices from "@/components/admin/Notices";
import Alert from "@/components/Alert";
import { listMembers } from "@/lib/services/memberAdminService";
import { listPlans } from "@/lib/services/planAdminService";
import { firstParam, formatPrice, isMemberRole, type SearchParams } from "@/lib/types";

export const metadata: Metadata = { title: "Admin · Members" };
export const dynamic = "force-dynamic";

export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const session = await requireRole("/admin/members", "Admin");

  const q = (firstParam(params.q) ?? "").trim();
  const rawPage = Number(firstParam(params.page) ?? "1");
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
  const deactivateId = Number(firstParam(params.deactivate));

  const [members, plans] = await Promise.all([
    listMembers(session, { search: q, page }),
    listPlans(session),
  ]);
  const data = members.data;
  const activePlans = (plans.data ?? []).filter((p) => p.isActive);

  const query = (nextPage: number) => {
    const search = new URLSearchParams();
    if (q) search.set("q", q);
    if (nextPage > 1) search.set("page", String(nextPage));
    const text = search.toString();
    return text ? `/admin/members?${text}` : "/admin/members";
  };
  const here = query(page);
  const target = data?.items.find((m) => m.id === deactivateId);

  return (
    <>
      <div className="section-head">
        <p className="eyebrow">Admin</p>
        <h2>Members</h2>
        <p className="lead">Every account: members, fighters, coaches and administrators.</p>
      </div>

      <Notices notice={firstParam(params.notice)} error={firstParam(params.error)} />
      {!members.ok && <Alert kind="err">{members.error ?? "Members could not be loaded."}</Alert>}

      <form className="admin-toolbar" action="/admin/members" method="get" role="search">
        <div className="field">
          <label htmlFor="f-q">Search by name or email</label>
          <input id="f-q" name="q" type="search" defaultValue={q} maxLength={100} />
          <span className="error" role="alert" />
        </div>
        <button className="btn btn--red btn--sm" type="submit">
          Search
        </button>
        {q && (
          <Link className="btn btn--line btn--sm" href="/admin/members">
            Clear
          </Link>
        )}
      </form>

      {target && (
        <ConfirmBar
          message={`Deactivate ${target.fullName}? They can no longer sign in, their current session stops working, and their future bookings are cancelled.`}
          action={deactivateUserAction}
          fields={{ id: target.id, q, page }}
          confirmLabel="Deactivate account"
          cancelHref={here}
        />
      )}

      <section className="admin-section" aria-labelledby="members-heading">
        <h3 id="members-heading">
          {data ? `${data.total} ${data.total === 1 ? "account" : "accounts"}` : "Accounts"}
          {q ? ` matching “${q}”` : ""}
        </h3>

        <div className="table-wrap">
          <table className="admin-table">
            <caption className="sr-only">Accounts</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Role</th>
                <th scope="col">Plan</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No accounts match.
                  </td>
                </tr>
              )}
              {data?.items.map((m) => (
                <tr key={m.id}>
                  <td>
                    {m.fullName}
                    <div className="muted">{m.email}</div>
                  </td>
                  <td>
                    <span className={`tag ${m.role === "Admin" ? "tag--red" : ""}`}>{m.role}</span>
                  </td>
                  <td>
                    {isMemberRole(m.role) ? (
                      <form className="admin-actions" action={setMemberPlanAction}>
                        <input type="hidden" name="id" value={m.id} />
                        <input type="hidden" name="q" value={q} />
                        <input type="hidden" name="page" value={page} />
                        <label className="sr-only" htmlFor={`plan-${m.id}`}>
                          Plan for {m.fullName}
                        </label>
                        <select id={`plan-${m.id}`} name="planId" defaultValue={m.planId ?? ""}>
                          <option value="">No plan</option>
                          {activePlans.map((p) => (
                            <option key={p.id} value={p.id}>
                              R{formatPrice(p.pricePerMonth)} / month
                            </option>
                          ))}
                        </select>
                        <button className="btn btn--grey btn--sm" type="submit">
                          Save
                        </button>
                      </form>
                    ) : (
                      <span className="muted">Staff</span>
                    )}
                  </td>
                  <td>
                    <span className={`tag ${m.isActive ? "tag--ok" : "tag--off"}`}>
                      {m.isActive ? "Active" : "Deactivated"}
                    </span>
                  </td>
                  <td>
                    <div className="admin-actions">
                      {m.id === session.id ? (
                        <span className="muted">This is you</span>
                      ) : m.isActive ? (
                        <Link
                          className="btn btn--line btn--sm"
                          href={`${here}${here.includes("?") ? "&" : "?"}deactivate=${m.id}`}
                          scroll={false}
                          aria-label={`Deactivate ${m.fullName}`}
                        >
                          Deactivate
                        </Link>
                      ) : (
                        <form action={reactivateUserAction}>
                          <input type="hidden" name="id" value={m.id} />
                          <input type="hidden" name="q" value={q} />
                          <input type="hidden" name="page" value={page} />
                          <button
                            className="btn btn--line btn--sm"
                            type="submit"
                            aria-label={`Reactivate ${m.fullName}`}
                          >
                            Reactivate
                          </button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {data && (
          <nav className="admin-pager" aria-label="Pages">
            {data.page > 1 ? (
              <Link className="btn btn--grey btn--sm" href={query(data.page - 1)}>
                Previous
              </Link>
            ) : (
              <span />
            )}
            <span className="muted">
              Page {data.page} of {data.pageCount}
            </span>
            {data.page < data.pageCount ? (
              <Link className="btn btn--grey btn--sm" href={query(data.page + 1)}>
                Next
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </section>
    </>
  );
}
