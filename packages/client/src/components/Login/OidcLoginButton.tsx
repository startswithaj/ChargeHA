import { Button } from "@radix-ui/themes";
import { LogIn } from "lucide-react";

export function OidcLoginButton() {
  const handleClick = () => {
    globalThis.location.href = "/auth/oidc/login";
  };

  return (
    <Button size="3" onClick={handleClick} style={{ width: "100%" }}>
      <LogIn size={18} />
      Sign in with SSO
    </Button>
  );
}
