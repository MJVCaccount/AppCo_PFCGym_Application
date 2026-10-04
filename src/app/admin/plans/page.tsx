import type { Metadata } from "next";
import Link from "next/link";

import {
  createPlanAction,
  deactivatePlanAction,
  updatePlanAction,
} from "@/actions/admin";
import { requireRole } from "@/actions/auth";
import ConfirmBar from "@/components/admin/ConfirmBar";
import Notices from "@/components/admin/Notices";
import PlanForm from "@/components/admin/PlanForm";
import Alert from "@/components/Alert";
import { listPlans } from "@/lib/services/planAdminService";
import { firstParam, formatPrice, type SearchParams } from "@/lib/types";

export const metadata: Metadata = { title: "Admin · Plans" };
export const dynamic = "force-dynamic";

export default async function AdminPlansPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const session = await requireRole("/admin/plans", "Admin");

  const editId = Number(firstParam(params.edit));
  const retireId = Number(firstParam(params.retire));

  const result = await listPlans(session);
  const plans = result.data ?? [];
  const editing = plans.find((p) => p.id === editId);
  const retiring = plans.find((p) => p.id === retireId && p.isActive);

  return (
    <>
      <div className="section-head">
        <p className="eyebrow">Admin</p>
        <h2>Plans</h2>
        <p className="lead">Prices are whole rands per month. Only one plan can be the most popular.</p>
      </div>

      <Notices notice={firstParam(params.notice)} error={firstParam(params.error)} />
      {!result.ok && <Alert kind="err">{result.error ?? "Plans could not be loaded."}</Alert>}

      {retiring && (
        <ConfirmBar
          message={
            retiring.activeMembers > 0
              ? `${retiring.activeMembers} active ${retiring.activeMembers === 1 ? "member is" : "members are"} on the R${formatPrice(retiring.pricePerMonth)} plan, so it cannot be retired yet. You can still press the button to see the reason.`
              : `Retire the R${formatPrice(retiring.pricePerMonth)} plan? Nobody new can choose it.`
          }
          action={deactivatePlanAction}
          fields={{ id: retiring.id }}
          confirmLabel="Retire plan"
          cancelHref="/admin/plans"
        />
      )}

      <section className="admin-section" aria-labelledby="plans-heading">
        <h3 id="plans-heading">All plans</h3>
        <div className="table-wrap">
          <table className="admin-table">
            <caption className="sr-only">Membership plans</caption>
            <thead>
              <tr>
                <th scope="col">Price</th>
                <th scope="col">Features</th>
                <th scope="col">Active members</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id}>
                  <td>
                    R{formatPrice(p.pricePerMonth)}
                    {p.isMostPopular && (
                      <div>
                        <span className="tag tag--red">Most popular</span>
                      </div>
                    )}
                  </td>
                  <td className="muted">{p.features.join(" · ")}</td>
                  <td>{p.activeMembers}</td>
                  <td>
                    <span className={`tag ${p.isActive ? "tag--ok" : "tag--off"}`}>
                      {p.isActive ? "On sale" : "Retired"}
                    </span>
                  </td>
                  <td>
                    <div className="admin-actions">
                      <Link
                        className="btn btn--grey btn--sm"
                        href={`/admin/plans?edit=${p.id}`}
                        scroll={false}
                        aria-label={`Edit the R${formatPrice(p.pricePerMonth)} plan`}
                      >
                        Edit
                      </Link>
                      {p.isActive && (
                        <Link
                          className="btn btn--line btn--sm"
                          href={`/admin/plans?retire=${p.id}`}
                          scroll={false}
                          aria-label={`Retire the R${formatPrice(p.pricePerMonth)} plan`}
                        >
                          Retire
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editing ? (
        <div className="admin-card">
          <h3>Edit the R{formatPrice(editing.pricePerMonth)} plan</h3>
          <PlanForm
            key={editing.id}
            action={updatePlanAction}
            submitLabel="Save changes"
            initial={{
              id: String(editing.id),
              pricePerMonth: String(editing.pricePerMonth),
              features: editing.features.join("\n"),
              isMostPopular: editing.isMostPopular,
            }}
          />
          <p style={{ marginTop: 12 }}>
            <Link className="pill-link" href="/admin/plans" scroll={false}>
              Cancel editing
            </Link>
          </p>
        </div>
      ) : (
        <div className="admin-card">
          <h3>Add a plan</h3>
          <PlanForm action={createPlanAction} submitLabel="Add plan" />
        </div>
      )}
    </>
  );
}
