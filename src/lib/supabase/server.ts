import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { supabaseKey, supabaseUrl } from "./env";

/** Session-aware client for the back office and customer accounts. Reads and refreshes the auth cookies. */
export async function createSessionClient() {
  // Request time only. With Partial Prefetching, a link prefetch prerenders the route with the cookies available, and
  // supabase-js reads Date.now() while loading the session, which Next.js reports as an error ("unstable value
  // `Date.now()` while prerendering") on every admin and account prefetch. connection() stops the prerender here, so
  // the session is read when the page is actually requested. No effect in server actions and route handlers.
  await connection();
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only. Safe to ignore:
          // Server Actions and the next request refresh the session.
        }
      },
    },
  });
}
