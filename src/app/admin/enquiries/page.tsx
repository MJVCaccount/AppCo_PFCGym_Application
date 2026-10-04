import type { Metadata } from "next";
import Link from "next/link";

import { setEnquiryHandledAction } from "@/actions/admin";
import { requireRole } from "@/actions/auth";
import Notices from "@/components/admin/Notices";
import Alert from "@/components/Alert";
import { formatEventDate } from "@/lib/dates";
import { listInbox } from "@/lib/services/contactService";
import { firstParam, type SearchParams } from "@/lib/types";

export const metadata: Metadata = { title: "Admin · Enquiries" };
export const dynamic = "force-dynamic";

export default async function AdminEnquiriesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const session = await requireRole("/admin/enquiries", "Admin");

  const rawPage = Number(firstParam(params.page) ?? "1");
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;

  const result = await listInbox(session, { page });
  const data = result.data;

  const pageHref = (target: number) =>
    target > 1 ? `/admin/enquiries?page=${target}` : "/admin/enquiries";

  return (
    <>
      <div className="section-head">
        <p className="eyebrow">Admin</p>
        <h2>Enquiries</h2>
        <p className="lead">
          Messages from the contact form. Unhandled ones come first.
        </p>
      </div>

      <Notices notice={firstParam(params.notice)} error={firstParam(params.error)} />
      {!result.ok && (
        <Alert kind="err">{result.error ?? "Enquiries could not be loaded."}</Alert>
      )}

      <section className="admin-section" aria-labelledby="enquiries-heading">
        <h3 id="enquiries-heading">
          {data ? `${data.total} ${data.total === 1 ? "enquiry" : "enquiries"}` : "Enquiries"}
        </h3>

        <div className="table-wrap">
          <table className="admin-table">
            <caption className="sr-only">Contact enquiries</caption>
            <thead>
              <tr>
                <th scope="col">From</th>
                <th scope="col">Message</th>
                <th scope="col">Received</th>
                <th scope="col">Email</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No enquiries yet.
                  </td>
                </tr>
              )}
              {data?.items.map((enquiry) => (
                <tr key={enquiry.id}>
                  <td>
                    {enquiry.fullName}
                    <div className="muted">{enquiry.email}</div>
                    <div className="muted">{enquiry.phone ?? "No phone given"}</div>
                  </td>
                  <td style={{ whiteSpace: "pre-wrap", maxWidth: 360 }}>
                    {enquiry.message}
                  </td>
                  <td>
                    <time dateTime={enquiry.createdAt}>
                      {formatEventDate(enquiry.createdAt)}
                    </time>
                    <div>
                      <span className={`tag ${enquiry.handledAt ? "tag--ok" : "tag--red"}`}>
                        {enquiry.handledAt ? "Handled" : "Unhandled"}
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className={`tag ${enquiry.emailSentAt ? "tag--ok" : "tag--off"}`}>
                      {enquiry.emailSentAt ? "Emailed to gym" : "Not emailed"}
                    </span>
                  </td>
                  <td>
                    <form action={setEnquiryHandledAction}>
                      <input type="hidden" name="id" value={enquiry.id} />
                      <input type="hidden" name="page" value={page} />
                      <input
                        type="hidden"
                        name="handled"
                        value={enquiry.handledAt ? "false" : "true"}
                      />
                      <button
                        className="btn btn--line btn--sm"
                        type="submit"
                        aria-label={`${enquiry.handledAt ? "Reopen" : "Mark handled"}: enquiry from ${enquiry.fullName}`}
                      >
                        {enquiry.handledAt ? "Reopen" : "Mark handled"}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {data && (
          <nav className="admin-pager" aria-label="Pages">
            {data.page > 1 ? (
              <Link className="btn btn--grey btn--sm" href={pageHref(data.page - 1)}>
                Previous
              </Link>
            ) : (
              <span />
            )}
            <span className="muted">
              Page {data.page} of {data.pageCount}
            </span>
            {data.page < data.pageCount ? (
              <Link className="btn btn--grey btn--sm" href={pageHref(data.page + 1)}>
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
