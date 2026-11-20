// Feature gate for public self-service sign-up.
//
// While the app is in closed development we deploy it to the real domain
// (app.zoonox.de) so the URL is stable for Enable Banking, but nobody must be
// able to register. This flag is the server-authoritative gate.
//
// Resolution:
//   - explicit ALLOW_SIGNUP=true|false wins
//   - otherwise: enabled in development, DISABLED in production (safe default)
export function isSignupEnabled(): boolean {
  const flag = process.env.ALLOW_SIGNUP;
  if (flag === "true") return true;
  if (flag === "false") return false;
  return process.env.NODE_ENV !== "production";
}
