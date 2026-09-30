interface Props {
  kind: "ok" | "err";
  children: React.ReactNode;
}

/**
 * role="status" announces politely, role="alert" interrupts — the right split
 * for a confirmation versus an error a screen reader user needs now.
 */
export default function Alert({ kind, children }: Props) {
  return (
    <p
      className={`alert alert--${kind} is-shown`}
      role={kind === "ok" ? "status" : "alert"}
    >
      {children}
    </p>
  );
}
