/**
 * Runs once when the server starts. A bad APP_URL stops a production server
 * from starting at all, instead of sending password reset links that point
 * somewhere wrong.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // `next build` loads this too; the check belongs to a running server.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { validateEnv } = await import("./lib/env");
  validateEnv();
}
