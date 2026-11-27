import fixture from "./account-fixture.json";

/**
 * The signed-in session of the account suites (account-signout.spec.ts, account-orders.spec.ts): the made-up customer of
 * account-fixture.json, accepted by the local Supabase mock (scripts/e2e-mock-supabase.mjs) and nothing else.
 */
export const SESSION_COOKIE = "sb-localhost-auth-token";

/**
 * The session cookie as @supabase/ssr writes it: "base64-" + base64url(JSON), named after the project host. The mock
 * keeps pauses per session id (scripts/e2e-mock-supabase.mjs): a suite that adds pauses passes its own id starting
 * with "pause-", so it never changes what another suite or project sees.
 */
export function sessionCookie(sessionId = "e2e") {
  const b64 = (value: string) => Buffer.from(value).toString("base64url");
  const expiresAt = Math.floor(Date.now() / 1000) + 30 * 86_400;
  const accessToken = [
    b64(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    b64(JSON.stringify({ sub: fixture.user.id, exp: expiresAt, role: "authenticated", aud: "authenticated", session_id: sessionId })),
    fixture.tokenSignature,
  ].join(".");
  const session = {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: 30 * 86_400,
    expires_at: expiresAt,
    refresh_token: "e2e-refresh",
    user: { id: fixture.user.id, aud: "authenticated", role: "authenticated", email: fixture.user.email },
  };
  return `base64-${b64(JSON.stringify(session))}`;
}
