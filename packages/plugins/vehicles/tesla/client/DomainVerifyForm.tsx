import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Callout, Text } from "@radix-ui/themes";
import { AlertCircle, CheckCircle } from "lucide-react";
import { useTeslaConfigMutation } from "./useTeslaConfig.ts";
import { stepStyles as styles } from "../../../hostUi.ts";

interface DomainVerifyFormProps {
  publicKey: string;
  wellKnownPath: string;
}

function VerifyResult(
  { verifyMutation }: {
    verifyMutation: ReturnType<
      typeof useMutation<unknown, Error, void, unknown>
    >;
  },
) {
  if (verifyMutation.isSuccess) {
    return (
      <Callout.Root color="green" size="1">
        <Callout.Icon>
          <CheckCircle size={14} />
        </Callout.Icon>
        <Callout.Text>Public key verified successfully.</Callout.Text>
      </Callout.Root>
    );
  }
  if (verifyMutation.isError) {
    return (
      <Callout.Root color="red" size="1">
        <Callout.Icon>
          <AlertCircle size={14} />
        </Callout.Icon>
        <Callout.Text>{verifyMutation.error.message}</Callout.Text>
      </Callout.Root>
    );
  }
  return null;
}

export function DomainVerifyForm({
  publicKey,
  wellKnownPath,
}: DomainVerifyFormProps) {
  const [externalDomain, setExternalDomain] = useState("");
  const teslaMutation = useTeslaConfigMutation();

  const normalizedDomain = externalDomain && !externalDomain.startsWith("http")
    ? `https://${externalDomain}`
    : externalDomain;
  const publicKeyUrl = `${normalizedDomain}/${wellKnownPath}`;

  const verifyMutation = useMutation({
    mutationFn: async () => {
      // Save the domain to tesla_public_key_domain config before verifying
      const stripped = externalDomain.replace(/\/+$/, "");
      const cleanDomain = (stripped && !stripped.startsWith("http"))
        ? `https://${stripped}`
        : stripped;
      await teslaMutation.mutateAsync({
        teslaPublicKeyDomain: cleanDomain,
        teslaPublicKeyHosting: "custom",
      });
      setExternalDomain(cleanDomain);

      const res = await fetch(publicKeyUrl, { cache: "no-store" });
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
      <div className={styles.fieldGroup}>
        <Text as="label" size="2" weight="medium">
          Domain where your key is hosted
        </Text>
        <Text as="p" size="1" color="gray">
          Just the base domain — the <code>{wellKnownPath}</code>{" "}
          path is added automatically.
        </Text>
        <input
          type="text"
          placeholder="https://example.com"
          value={externalDomain}
          onChange={(e: { target: { value: string } }) => {
            setExternalDomain(e.target.value.replace(/\/+$/, ""));
            verifyMutation.reset();
          }}
          style={{
            padding: "0.5rem 0.75rem",
            borderRadius: "var(--radius-2)",
            border: "1px solid var(--gray-a6)",
            fontSize: "0.875rem",
            fontFamily: "var(--code-font-family)",
          }}
        />
        {externalDomain.trim() && (
          <Text as="p" size="1" color="gray" style={{ marginTop: "0.25rem" }}>
            Tesla will fetch: <code>{publicKeyUrl}</code>
          </Text>
        )}
      </div>

      <div className={styles.verifyRow}>
        <Button
          variant="soft"
          onClick={() => verifyMutation.mutate()}
          disabled={verifyMutation.isPending || !externalDomain.trim()}
        >
          {verifyMutation.isPending ? "Verifying..." : "Verify"}
        </Button>
        <VerifyResult verifyMutation={verifyMutation} />
      </div>
    </>
  );
}
