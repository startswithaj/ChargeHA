import { useMutation } from "@tanstack/react-query";
import { Button, Callout, Text } from "@radix-ui/themes";
import { AlertCircle, CheckCircle, ExternalLink } from "lucide-react";
import { CopyButton } from "./PublicKeyHostingParts.tsx";
import styles from "../../../../client/src/components/Wizard/steps/steps.module.css";

interface DirectHostingSectionProps {
  publicKeyUrl: string;
  publicKey: string;
}

/** Shown when ChargeHA is internet-accessible — displays the URL and a verify button. */
export function DirectHostingSection(
  { publicKeyUrl, publicKey }: DirectHostingSectionProps,
) {
  const verifyMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(publicKeyUrl);
      if (!res.ok) {
        throw new Error(`Failed to fetch public key: HTTP ${res.status}`);
      }

      const fetchedKey = await res.text();
      if (fetchedKey.trim() !== publicKey.trim()) {
        throw new Error(
          "The key at the URL does not match the stored key. Check your hosting setup.",
        );
      }
    },
  });

  return (
    <>
      <div className={styles.instructionBox}>
        <Text as="p" size="2" weight="medium">
          Your public key URL:
        </Text>
        <div className={styles.copyRow}>
          <code className={styles.codeSnippet}>{publicKeyUrl}</code>
          <CopyButton text={publicKeyUrl} />
        </div>

        <Text as="p" size="2" style={{ marginTop: "0.75rem" }}>
          Make sure this URL is reachable from the internet and that your domain
          is listed in <strong>Allowed Origins</strong> on the{" "}
          <a
            href="https://developer.tesla.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Tesla Developer Portal
            <ExternalLink
              size={12}
              style={{ marginLeft: 4, verticalAlign: "middle" }}
            />
          </a>.
        </Text>
      </div>

      <div className={styles.verifyRow}>
        <Button
          variant="soft"
          onClick={() => verifyMutation.mutate()}
          disabled={verifyMutation.isPending}
        >
          {verifyMutation.isPending ? "Verifying..." : "Verify"}
        </Button>
        {verifyMutation.isSuccess && (
          <Callout.Root color="green" size="1">
            <Callout.Icon>
              <CheckCircle size={14} />
            </Callout.Icon>
            <Callout.Text>Public key verified successfully.</Callout.Text>
          </Callout.Root>
        )}
        {verifyMutation.isError && (
          <Callout.Root color="red" size="1">
            <Callout.Icon>
              <AlertCircle size={14} />
            </Callout.Icon>
            <Callout.Text>{verifyMutation.error.message}</Callout.Text>
          </Callout.Root>
        )}
      </div>
    </>
  );
}
