import { type ReactNode, useCallback, useMemo } from "react";
import { Text } from "@radix-ui/themes";
import { AlertTriangle } from "lucide-react";
import { trpc } from "../trpc.ts";
import { queryClient } from "../lib/trpcSetup.ts";
import { useRouter } from "../hooks/useRouter.ts";
import { LoginPage } from "./Login/LoginPage.tsx";
import { Spinner } from "./ui/Spinner.tsx";

export interface AuthInfo {
  authMode: string;
  onLogout: () => void;
}

interface AuthGateProps {
  children: (auth: AuthInfo) => ReactNode;
}

/** Persistent warning banner shown when RESET_AUTH env var is active. */
function ResetAuthBanner() {
  return (
    <div
      style={{
        background: "var(--orange-a3)",
        borderBottom: "1px solid var(--orange-a6)",
        padding: "8px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
      }}
    >
      <AlertTriangle
        size={16}
        style={{ color: "var(--orange-9)", flexShrink: 0 }}
      />
      <Text size="2" color="orange" weight="medium">
        Authentication is disabled via RESET_AUTH environment variable
      </Text>
    </div>
  );
}

/**
 * Auth gate component that handles auth session query, loading spinner,
 * and login page rendering. Children only render when authenticated.
 *
 * Uses render props: children receives `{ authMode, onLogout }` so
 * downstream components can access auth info without extra context.
 */
export function AuthGate({ children }: AuthGateProps) {
  const { navigate } = useRouter();
  const authSessionQuery = trpc.auth.session.useQuery(undefined, {
    retry: false,
  });

  const authData = authSessionQuery.data;
  const authMode = authData?.authMode ?? "none";
  const isAuthenticated = authData?.authenticated !== false;
  const resetAuthActive = authData != null && "resetAuthActive" in authData &&
    authData.resetAuthActive === true;
  const canProceed = authMode === "none" || isAuthenticated;

  // Extract error code from URL query params for login page (e.g. OIDC callback errors)
  const loginErrorCode = useMemo(() => {
    const params = new URLSearchParams(globalThis.location.search);
    return params.get("error");
  }, []);

  const handleLoginSuccess = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: [["auth", "session"]] });
    navigate({ type: "app", page: "dashboard" });
  }, [navigate]);

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      queryClient.clear();
      navigate({ type: "login" });
      // Force re-fetch of auth session to trigger login page render
      queryClient.invalidateQueries({ queryKey: [["auth", "session"]] });
    },
  });

  const handleLogout = useCallback(() => {
    logoutMutation.mutate();
  }, [logoutMutation]);

  // While auth check is loading, show loading state
  if (authSessionQuery.isPending) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
        }}
      >
        <Spinner size="lg" />
      </div>
    );
  }

  // If auth is required and user is not authenticated, show login page
  if (!canProceed) {
    return (
      <LoginPage
        authMode={authMode}
        onSuccess={handleLoginSuccess}
        errorCode={loginErrorCode}
      />
    );
  }

  return (
    <>
      {resetAuthActive && <ResetAuthBanner />}
      {children({ authMode, onLogout: handleLogout })}
    </>
  );
}
