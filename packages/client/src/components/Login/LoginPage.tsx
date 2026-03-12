import { Text } from "@radix-ui/themes";
import { LocalLoginForm } from "./LocalLoginForm.tsx";
import { OidcLoginButton } from "./OidcLoginButton.tsx";
import logoSrc from "../../assets/chargeha_soft-plug_brand.svg";
import styles from "./LoginPage.module.css";

type AuthMode = "none" | "local" | "oidc";

interface LoginPageProps {
  authMode: AuthMode;
  onSuccess: () => void;
  errorCode?: string | null;
}

const ERROR_MESSAGES: Record<string, string> = {
  provider_denied: "Access was denied by your identity provider",
  state_mismatch: "Login session expired \u2014 please try again",
  token_exchange_failed: "Authentication failed \u2014 please try again",
  provider_unreachable: "Could not reach your identity provider",
};

export function LoginPage({ authMode, onSuccess, errorCode }: LoginPageProps) {
  const errorMessage = errorCode
    ? ERROR_MESSAGES[errorCode] ?? errorCode
    : null;

  return (
    <div className={styles.loginWrapper}>
      <div className={styles.loginCard}>
        <div className={styles.brand}>
          <img
            src={logoSrc}
            alt="ChargeHA"
            className={styles.logo}
          />
          <Text size="5" weight="bold">
            Charge<span className={styles.accent}>HA</span>
          </Text>
        </div>

        {errorMessage && (
          <div className={styles.errorBanner}>
            <Text as="p" size="2" color="red">
              {errorMessage}
            </Text>
          </div>
        )}

        <div className={styles.formWrapper}>
          {authMode === "local" && <LocalLoginForm onSuccess={onSuccess} />}
          {authMode === "oidc" && <OidcLoginButton />}
        </div>
      </div>
    </div>
  );
}
