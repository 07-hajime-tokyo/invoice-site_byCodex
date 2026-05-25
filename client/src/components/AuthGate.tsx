import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Mail, ShieldCheck } from "lucide-react";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [email, setEmail] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const { data, isLoading, refetch } = trpc.authGate.checkVerified.useQuery(undefined, {
    retry: false,
    staleTime: 1000 * 60 * 5,
  });

  const loginMutation = trpc.authGate.loginWithEmail.useMutation({
    onSuccess: async (result) => {
      if (!result.success) {
        setErrorMsg(result.message);
        return;
      }
      setErrorMsg("");
      setEmail("");
      await refetch();
    },
    onError: (err) => {
      setErrorMsg(err.message || "ログインに失敗しました");
    },
  });

  const handleLogin = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setErrorMsg("メールアドレスを入力してください");
      return;
    }
    setErrorMsg("");
    loginMutation.mutate({ email: trimmedEmail });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F4F5F7]">
        <Loader2 size={28} className="animate-spin text-primary" />
      </div>
    );
  }

  if (!data?.loggedIn || !data?.verified) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F4F5F7] p-4">
        <div className="w-full max-w-sm rounded-lg border border-border bg-white p-8 text-center shadow-md">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Mail size={26} className="text-primary" />
          </div>
          <div className="mt-5">
            <h1 className="text-lg font-bold text-foreground">ログイン</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              許可されたメールアドレスを入力してください。
            </p>
          </div>
          <form className="mt-5 space-y-3" onSubmit={handleLogin}>
            <Input
              type="email"
              placeholder="メールアドレス"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="text-center text-base"
              autoComplete="email"
              autoFocus
            />
            {errorMsg && (
              <p className="text-xs font-medium text-destructive">{errorMsg}</p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? (
                <>
                  <Loader2 size={14} className="mr-2 animate-spin" />
                  確認中...
                </>
              ) : (
                "ログイン"
              )}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="hidden" aria-hidden>
        <ShieldCheck size={14} className="text-green-500" />
      </div>
      {children}
    </>
  );
}
