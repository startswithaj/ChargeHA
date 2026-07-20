import { useState } from "react";
import { Button, Text } from "@radix-ui/themes";
import { Check, Copy } from "lucide-react";
import { stepStyles as styles } from "../../../hostUi.ts";

export const WELL_KNOWN_PATH =
  ".well-known/appspecific/com.tesla.3p.public-key.pem";

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for non-secure contexts (HTTP on LAN)
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button size="1" variant="ghost" onClick={handleCopy}>
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? "Copied" : (label ?? "Copy")}
    </Button>
  );
}

function PublicKeyBlock({ publicKey }: { publicKey: string }) {
  return (
    <>
      <pre className={styles.codeBlock}>{publicKey}</pre>
      <div className={styles.copyRow}>
        <CopyButton text={publicKey} label="Copy public key" />
      </div>
    </>
  );
}

export function buildAiPrompt(publicKey: string): string {
  return `I need to host a Tesla Fleet API public key on GitHub Pages so Tesla can verify my app's identity.

Here is my public key:

\`\`\`
${publicKey}
\`\`\`

Please help me do the following using the \`gh\` CLI:

1. Create a new public GitHub repository called \`tesla-public-key\`
2. Clone it locally
3. Create the file \`.well-known/appspecific/com.tesla.3p.public-key.pem\` containing my public key above
4. Create an empty \`.nojekyll\` file in the repo root (so GitHub Pages serves the .well-known directory)
5. Commit and push everything
6. Enable GitHub Pages on the main branch using the GitHub API

Give me the exact commands to run. At the end, tell me what my public key URL will be.`;
}

interface HostingInstructionsProps {
  publicKey: string;
}

export function SelfHostInstructions({ publicKey }: HostingInstructionsProps) {
  return (
    <div className={styles.instructionBox}>
      <Text as="p" size="2" weight="medium">
        Host your public key on any static hosting service:
      </Text>
      <ol className={styles.instructionList}>
        <li>
          <Text as="span" size="2">
            Create the following file path on your host:
          </Text>
          <pre className={styles.codeBlock}>
{WELL_KNOWN_PATH}
          </pre>
        </li>
        <li>
          <Text as="span" size="2">
            Copy your public key into the PEM file:
          </Text>
          <PublicKeyBlock publicKey={publicKey} />
        </li>
        <li>
          <Text as="span" size="2">
            Make sure the <code>.well-known</code>{" "}
            directory is served. Some hosts ignore dot-directories by default.
          </Text>
        </li>
      </ol>
    </div>
  );
}

export function GitHubPagesInstructions(
  { publicKey }: HostingInstructionsProps,
) {
  return (
    <div className={styles.instructionBox}>
      <Text as="p" size="2" weight="medium">
        Host your public key on GitHub Pages:
      </Text>
      <ol className={styles.instructionList}>
        <li>
          <Text as="span" size="2">
            Create a new GitHub repository (e.g., <code>tesla-public-key</code>)
          </Text>
        </li>
        <li>
          <Text as="span" size="2">
            Create the directory structure:
          </Text>
          <pre className={styles.codeBlock}>
{WELL_KNOWN_PATH}
          </pre>
        </li>
        <li>
          <Text as="span" size="2">
            Copy your public key into the PEM file:
          </Text>
          <PublicKeyBlock publicKey={publicKey} />
        </li>
        <li>
          <Text as="span" size="2">
            Add a <code>.nojekyll</code>{" "}
            file to the repository root. This prevents GitHub Pages from
            ignoring the <code>.well-known</code>{" "}
            directory (which starts with a dot).
          </Text>
        </li>
        <li>
          <Text as="span" size="2">
            Enable GitHub Pages in repository Settings → Pages → Source: main
            branch
          </Text>
        </li>
      </ol>
    </div>
  );
}

export function FleetKeyInstructions(
  { publicKey }: HostingInstructionsProps,
) {
  return (
    <div className={styles.instructionBox}>
      <Text as="p" size="2" weight="medium">
        Host your public key on FleetKey.net (free, by Teslemetry):
      </Text>
      <ol className={styles.instructionList}>
        <li>
          <Text as="span" size="2">
            Copy your public key:
          </Text>
          <div className={styles.copyRow}>
            <CopyButton text={publicKey} label="Copy public key" />
          </div>
        </li>
        <li>
          <Text as="span" size="2">
            Go to{" "}
            <a
              href="https://fleetkey.net"
              target="_blank"
              rel="noopener noreferrer"
            >
              fleetkey.net
            </a>, paste the key, and click Create.
          </Text>
        </li>
        <li>
          <Text as="span" size="2">
            You'll get a domain like <code>abc12.fleetkey.net</code>{" "}
            — verify it below.
          </Text>
        </li>
      </ol>
    </div>
  );
}

export function AiPromptInstructions({ publicKey }: HostingInstructionsProps) {
  const prompt = buildAiPrompt(publicKey);

  return (
    <div className={styles.instructionBox}>
      <Text as="p" size="2" weight="medium">
        Copy this prompt and paste it into ChatGPT, Claude, or any AI assistant:
      </Text>
      <div style={{ position: "relative", marginTop: "0.5rem" }}>
        <pre className={styles.codeBlock} style={{ whiteSpace: "pre-wrap" }}>
{prompt}
        </pre>
        <div style={{ marginTop: "0.5rem" }}>
          <CopyButton text={prompt} label="Copy prompt" />
        </div>
      </div>
      <Text as="p" size="2" color="gray" style={{ marginTop: "0.75rem" }}>
        Once the AI has set everything up, paste your GitHub Pages URL below and
        click Verify to confirm it's working.
      </Text>
    </div>
  );
}
