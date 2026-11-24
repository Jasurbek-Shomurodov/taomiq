/**
 * The path a trailing-slash redirect in src/proxy.ts goes to: runs of slashes (and backslashes, which browsers read
 * as slashes) collapsed to one, the trailing slash removed, "/" when nothing is left.
 *
 * Collapsing matters for safety, not only tidiness: a same-host redirect is sent with a relative Location, so a path
 * such as //attacker.example/ must never become "//attacker.example", which a browser reads as another site.
 * The result always starts with exactly one slash.
 */
export function withoutTrailingSlash(pathname: string): string {
  return `/${pathname.replace(/[\\/]+/g, "/").replace(/^\/+|\/+$/g, "")}`;
}
