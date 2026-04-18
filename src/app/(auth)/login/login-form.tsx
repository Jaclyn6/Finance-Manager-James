"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface LoginFormProps {
  /** Path to navigate to after successful login. Defaults to /dashboard. */
  nextPath: string;
}

export function LoginForm({ nextPath }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const supabase = getSupabaseBrowserClient();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setErrorMessage(
        error.message === "Invalid login credentials"
          ? "이메일 또는 비밀번호가 일치하지 않습니다."
          : error.message,
      );
      setIsSubmitting(false);
      return;
    }

    // Hard navigation: forces the proxy to re-read fresh cookies on the
    // next request so Server Components render with the authenticated
    // session. router.replace + router.refresh can race with cookie
    // propagation in some edge cases; a full reload is more reliable.
    window.location.assign(nextPath);
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>로그인</CardTitle>
        <CardDescription>
          가족 계정으로 로그인하면 오늘의 투자 상태를 확인할 수 있습니다.
        </CardDescription>
      </CardHeader>

      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">이메일</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">비밀번호</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          {errorMessage && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage}
            </p>
          )}
        </CardContent>

        <CardFooter className="flex flex-col gap-2">
          <Button
            type="submit"
            className="w-full"
            disabled={isSubmitting || !email || !password}
          >
            {isSubmitting ? "로그인 중..." : "로그인"}
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            참고용 해석 도구입니다. 확정적 투자 자문이 아닙니다.
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
