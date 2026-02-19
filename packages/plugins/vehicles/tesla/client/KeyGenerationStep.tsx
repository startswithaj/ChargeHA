import { useState } from "react";
import { Button, Callout, Text } from "@radix-ui/themes";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Loader2,
  Upload,
  Wand2,
} from "lucide-react";
import { useTeslaConfig } from "./useTeslaConfig.ts";
import { trpc } from "./trpc.ts";
import type { StepProps } from "../../../../client/src/components/Wizard/WizardShell.tsx";
import { KeyImportForm } from "./KeyImportForm.tsx";
import styles from "../../../../client/src/components/Wizard/steps/steps.module.css";

type Mode = "choose" | "generate" | "import";

function SuccessView(
  { mode, onNext }: { mode: Mode; onNext: () => void },
) {
  return (
    <div className={styles.stepContainer}>
      <Text as="p" size="3" color="gray">
        ChargeHA needs an EC key pair to communicate securely with the Tesla
        Fleet API.
      </Text>
      <Callout.Root color="green">
        <Callout.Icon>
          <CheckCircle size={16} />
        </Callout.Icon>
        <Callout.Text>
          Key pair {mode === "generate" ? "generated" : "imported"}{" "}
          and stored successfully.
        </Callout.Text>
      </Callout.Root>
      <div className={styles.stepActions}>
        <Button onClick={onNext}>Continue</Button>
      </div>
    </div>
  );
}

function ChooseModeCards(
  { handleGenerate, setImport }: {
    handleGenerate: () => void;
    setImport: () => void;
  },
) {
  return (
    <div className={styles.optionCards}>
      <div
        className={styles.optionCard}
        onClick={handleGenerate}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
      >
        <Text as="p" size="3" weight="medium">
          <Wand2 size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
          Generate a key pair for me
        </Text>
        <Text as="p" size="2" color="gray">
          Automatically creates an EC P-256 key pair and stores it.
        </Text>
      </div>
      <div
        className={styles.optionCard}
        onClick={setImport}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && setImport()}
      >
        <Text as="p" size="3" weight="medium">
          <Upload size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
          I have my own key pair
        </Text>
        <Text as="p" size="2" color="gray">
          Paste your existing PEM-encoded public and private keys.
        </Text>
      </div>
    </div>
  );
}

function ErrorCallout(
  { error, resetToChoose }: {
    error: { message: string };
    resetToChoose: () => void;
  },
) {
  return (
    <>
      <Callout.Root color="red">
        <Callout.Icon>
          <AlertCircle size={16} />
        </Callout.Icon>
        <Callout.Text>{error.message}</Callout.Text>
      </Callout.Root>
      <div className={styles.stepActions}>
        <Button variant="soft" onClick={resetToChoose}>Try Again</Button>
      </div>
    </>
  );
}

export function KeyGenerationStep({ onNext }: StepProps): JSX.Element {
  const [mode, setMode] = useState<Mode>("choose");
  const { data: teslaConfig } = useTeslaConfig();
  const hasExistingKeys = !!teslaConfig?.ecPublicKeyPem;
  const encryptionQuery = trpc.health.encryption.useQuery();
  const hasEncryptionKey = encryptionQuery.data?.configured ?? true;

  const resetToChoose = () => {
    setMode("choose");
    generateMutation.reset();
    importMutation.reset();
  };

  const generateMutation = trpc.tesla.generateKeys.useMutation();

  const importMutation = trpc.tesla.importKeys.useMutation();

  const handleGenerate = () => {
    setMode("generate");
    generateMutation.mutate();
  };

  const isSuccess = generateMutation.isSuccess || importMutation.isSuccess;
  const isPending = generateMutation.isPending || importMutation.isPending;
  const error = generateMutation.error ?? importMutation.error;

  if (isSuccess) {
    return <SuccessView mode={mode} onNext={onNext} />;
  }

  return (
    <div className={styles.stepContainer}>
      <Text as="p" size="3" color="gray">
        ChargeHA needs an EC key pair to communicate securely with the Tesla
        Fleet API.
      </Text>

      {hasExistingKeys && (
        <Callout.Root color="green">
          <Callout.Icon>
            <CheckCircle size={16} />
          </Callout.Icon>
          <Callout.Text>
            A key pair already exists. You can continue with the existing keys
            or generate new ones below.
          </Callout.Text>
        </Callout.Root>
      )}

      {!hasEncryptionKey && (
        <Callout.Root color="amber">
          <Callout.Icon>
            <AlertTriangle size={16} />
          </Callout.Icon>
          <Callout.Text>
            No <code>ENCRYPTION_KEY</code>{" "}
            is set. The private key will be stored in plain text. Set{" "}
            <code>ENCRYPTION_KEY</code> in your <code>.env</code>{" "}
            file to encrypt it at rest.
          </Callout.Text>
        </Callout.Root>
      )}

      {hasExistingKeys && mode === "choose" && (
        <div className={styles.stepActions}>
          <Button onClick={onNext}>Continue with existing keys</Button>
        </div>
      )}

      {mode === "choose" && (
        <ChooseModeCards
          handleGenerate={handleGenerate}
          setImport={() => setMode("import")}
        />
      )}

      {mode === "generate" && isPending && (
        <Callout.Root color="blue">
          <Callout.Icon>
            <Loader2 size={16} className={styles.spinner} />
          </Callout.Icon>
          <Callout.Text>Generating EC key pair...</Callout.Text>
        </Callout.Root>
      )}

      {mode === "import" && (
        <KeyImportForm
          isPending={isPending}
          onImport={(pub, priv) =>
            importMutation.mutate({
              publicKeyPem: pub,
              privateKeyPem: priv,
            })}
          onBack={resetToChoose}
        />
      )}

      {error && <ErrorCallout error={error} resetToChoose={resetToChoose} />}
    </div>
  );
}
