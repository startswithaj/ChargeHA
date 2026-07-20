import { useState } from "react";
import { Button, Text, TextArea } from "@radix-ui/themes";
import { Key, Loader2 } from "lucide-react";
import { stepStyles as styles } from "../../../hostUi.ts";

interface KeyImportFormProps {
  isPending: boolean;
  onImport: (publicKeyPem: string, privateKeyPem: string) => void;
  onBack: () => void;
}

export function KeyImportForm(
  { isPending, onImport, onBack }: KeyImportFormProps,
) {
  const [publicKeyPem, setPublicKeyPem] = useState("");
  const [privateKeyPem, setPrivateKeyPem] = useState("");

  return (
    <>
      <div className={styles.fieldGroup}>
        <Text as="label" size="2" weight="medium">
          Public Key (PEM)
        </Text>
        <TextArea
          placeholder="-----BEGIN PUBLIC KEY-----&#10;..."
          value={publicKeyPem}
          onChange={(e: { target: { value: string } }) =>
            setPublicKeyPem(e.target.value)}
          rows={4}
          style={{
            fontFamily: "var(--code-font-family)",
            fontSize: "0.8125rem",
          }}
        />
      </div>

      <div className={styles.fieldGroup}>
        <Text as="label" size="2" weight="medium">
          Private Key (PEM)
        </Text>
        <TextArea
          placeholder="-----BEGIN PRIVATE KEY-----&#10;..."
          value={privateKeyPem}
          onChange={(e: { target: { value: string } }) =>
            setPrivateKeyPem(e.target.value)}
          rows={4}
          style={{
            fontFamily: "var(--code-font-family)",
            fontSize: "0.8125rem",
          }}
        />
      </div>

      <div className={styles.stepActions}>
        <Button
          variant="soft"
          color="gray"
          onClick={onBack}
        >
          Back
        </Button>
        <Button
          onClick={() => onImport(publicKeyPem, privateKeyPem)}
          disabled={!publicKeyPem.trim() || !privateKeyPem.trim() || isPending}
        >
          {isPending
            ? <Loader2 size={16} className={styles.spinner} />
            : <Key size={16} />}
          Save Keys
        </Button>
      </div>
    </>
  );
}
