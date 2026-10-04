import { logout, requireRole } from "@/actions/auth";
import AdminNav from "@/components/admin/AdminNav";
import { initials } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The frame every admin page shares: the dashboard sidebar with the section
 * links. The guard is repeated in each page and action, since a layout does
 * not re-run when you move between its pages.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireRole("/admin/classes", "Admin");

  return (
    <div className="dash">
      <aside className="dash__side">
        <AdminNav />
        <div className="dash__user">
          <span className="dash__avatar" aria-hidden="true">
            {initials(session.fullName)}
          </span>
          <span>
            <b>{session.fullName}</b>
            <span>Administrator</span>
          </span>
        </div>
      </aside>

      <div className="dash__main">
        <div className="wrap">
          <div className="admin-top">
            <form action={logout}>
              <button className="pill-link" type="submit">
                Sign out
              </button>
            </form>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
