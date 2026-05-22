/**
 * AuthGate — wraps the entire app with Manus login + access code verification.
 *
 * Flow:
 * 1. Not logged in → show "Login with Manus" button
 * 2. Logged in but not verified → show access code input form
 * 3. Logged in and verified → render children
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock, LogIn, Loader2, ShieldCheck } from "lucide-react";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [code, setCode] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const { data, isLoading, refetch } = trpc.authGate.checkVerified.useQuery(undefined, {
    retry: false,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const verifyMutation = trpc.authGate.verifyCode.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        setErrorMsg("");
        refetch();
      } else {
        setErrorMsg(result.message);
      }
    },
    onError: (err) => {
      setErrorMsg(err.message || "認証に失敗しました");
    },
  });

  const handleVerify = () => {
    if (!code.trim()) {
      setErrorMsg("認証コードを入力してください");
      return;
    }
    setErrorMsg("");
    verifyMutation.mutate({ code: code.trim() });
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F4F5F7]">
        <Loader2 size={28} className="animate-spin text-primary" />
      </div>
    );
  }

  // Not logged in
  if (!data?.loggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F4F5F7] p-4">
        <div className="bg-white rounded-2xl shadow-md border border-border p-8 max-w-sm w-full text-center space-y-5">
          <div className="w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
            <LogIn size={26} className="text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">ログインが必要です</h1>
            <p className="text-sm text-muted-foreground mt-1">
              このサイトにアクセスするにはManusアカウントでのログインが必要です。
            </p>
          </div>
          <Button
            className="w-full"
            onClick={() => { window.location.href = getLoginUrl(); }}
          >
            Manusアカウントでログイン
          </Button>
        </div>
      </div>
    );
  }

  // Logged in but not verified
  if (!data?.verified) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F4F5F7] p-4">
        <div className="bg-white rounded-2xl shadow-md border border-border p-8 max-w-sm w-full text-center space-y-5">
          <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto">
            <Lock size={26} className="text-amber-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">認証コードを入力してください</h1>
            <p className="text-sm text-muted-foreground mt-1">
              アクセスするには認証コードが必要です。<br />
              一度認証すれば、次回以降は不要です。
            </p>
          </div>
          <div className="space-y-3">
            <Input
              type="password"
              placeholder="認証コードを入力..."
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleVerify()}
              className="text-center tracking-widest text-base"
              autoFocus
            />
            {errorMsg && (
              <p className="text-xs text-destructive font-medium">{errorMsg}</p>
            )}
            <Button
              className="w-full"
              onClick={handleVerify}
              disabled={verifyMutation.isPending}
            >
              {verifyMutation.isPending ? (
                <><Loader2 size={14} className="animate-spin mr-2" />確認中...</>
              ) : (
                "認証する"
              )}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Logged in and verified — render the app
  return (
    <>
      {/* Subtle verified badge (optional, can remove) */}
      <div className="hidden" aria-hidden>
        <ShieldCheck size={14} className="text-green-500" />
      </div>
      {children}
    </>
  );
}
