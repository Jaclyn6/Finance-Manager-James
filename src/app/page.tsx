import { redirect } from "next/navigation";

/**
 * Root route. Redirect to /dashboard unconditionally; the proxy
 * (src/proxy.ts) then handles the auth branch:
 * - Unauthenticated users: proxy bounces them to /login
 * - Authenticated users: they land on the dashboard directly
 */
export default function Home() {
  redirect("/dashboard");
}
