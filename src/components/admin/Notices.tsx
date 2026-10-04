import Alert from "@/components/Alert";

/** The success notice (role="status") and error (role="alert") from a redirect. */
export default function Notices({
  notice,
  error,
}: {
  notice?: string;
  error?: string;
}) {
  if (!notice && !error) return null;

  return (
    <div className="admin-section" style={{ marginBottom: 24 }}>
      {notice && <Alert kind="ok">{notice}</Alert>}
      {error && <Alert kind="err">{error}</Alert>}
    </div>
  );
}
