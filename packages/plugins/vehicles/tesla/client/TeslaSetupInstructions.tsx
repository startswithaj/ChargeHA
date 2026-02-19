import { Code, Text } from "@radix-ui/themes";

interface TeslaSetupInstructionsProps {
  origin: string;
  redirectUri: string;
}

export function TeslaSetupInstructions({
  origin,
  redirectUri,
}: TeslaSetupInstructionsProps): JSX.Element {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 12,
        borderRadius: 6,
        background: "var(--gray-a2)",
      }}
    >
      <Text size="2" color="gray">
        Create an app at{" "}
        <a
          href="https://developer.tesla.com"
          target="_blank"
          rel="noreferrer"
          style={{ color: "var(--accent-11)" }}
        >
          developer.tesla.com
        </a>{" "}
        with these values:
      </Text>
      <table style={{ fontSize: 13, borderCollapse: "collapse" }}>
        <tbody>
          <tr>
            <td
              style={{
                padding: "2px 12px 2px 0",
                color: "var(--gray-11)",
              }}
            >
              Allowed Origin
            </td>
            <td>
              <Code size="1">{origin}</Code>
            </td>
          </tr>
          <tr>
            <td
              style={{
                padding: "2px 12px 2px 0",
                color: "var(--gray-11)",
              }}
            >
              Redirect URI
            </td>
            <td>
              <Code size="1">{redirectUri}</Code>
            </td>
          </tr>
          <tr>
            <td
              style={{
                padding: "2px 12px 2px 0",
                color: "var(--gray-11)",
              }}
            >
              Scopes
            </td>
            <td>
              <Code size="1">
                Vehicle Information, Vehicle Location, Vehicle Charging
                Management
              </Code>
            </td>
          </tr>
        </tbody>
      </table>
      <Text size="1" color="gray">
        Then set <Code size="1">TESLA_CLIENT_ID</Code>,{" "}
        <Code size="1">TESLA_CLIENT_SECRET</Code>, and{" "}
        <Code size="1">TESLA_DOMAIN={origin}</Code> in your .env and restart.
      </Text>
    </div>
  );
}
