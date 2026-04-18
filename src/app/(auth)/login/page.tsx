import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { safeRelativePath } from "@/lib/utils/redirect";

import { LoginForm } from "./login-form";

type LoginSearchParams = Promise<{ next?: string }>;

/**
 * Login page — static shell with a Suspense-wrapped, searchParams-
 * dependent subtree.
 *
 * Under `cacheComponents: true`, awaiting `searchParams` at the top of a
 * Server Component turns the whole page into blocking dynamic content
 * and fails the prerender. The fix is to pass the Promise down into a
 * component inside `<Suspense>`, so Next can ship the static shell (the
 * <main> wrapper + Suspense boundary) immediately and stream the
 * dynamic bits when they resolve.
 */
export default function LoginPage({
  searchParams,
}: {
  searchParams: LoginSearchParams;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <Suspense fallback={<Skeleton className="h-[420px] w-full max-w-sm" />}>
        <LoginFormSlot searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

/**
 * Suspense-boundary child that awaits searchParams and wires the value
 * into the Client Component. Kept intentionally tiny so the dynamic
 * portion of the render tree is as small as possible.
 */
async function LoginFormSlot({
  searchParams,
}: {
  searchParams: LoginSearchParams;
}) {
  const { next } = await searchParams;
  const nextPath = safeRelativePath(next);
  return <LoginForm nextPath={nextPath} />;
}
