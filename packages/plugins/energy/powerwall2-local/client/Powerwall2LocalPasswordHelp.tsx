import { Text } from "@radix-ui/themes";

export function Powerwall2LocalPasswordHelp() {
  return (
    <Text as="div" size="2" color="gray">
      <details>
        <summary>Finding your Gateway password</summary>
        <p>
          These instructions are for Backup Gateway 2, not the Powerwall
          battery. Open only the Gateway's outer glass door and find the QR-code
          label with a field named{" "}
          <strong>Password</strong>. Do not remove electrical covers. If the
          label is inaccessible, ask your installer.
        </p>
        <p>
          Enter the <strong>last five characters</strong>{" "}
          of that Password field, preserving uppercase and lowercase. Fictional
          example: a printed Password of <code>Ab3De6Gh9J</code> means entering
          {" "}
          <code>6Gh9J</code>. Do not enter the whole label password, serial
          number, home Wi-Fi password or Tesla account password.
        </p>
        <p>
          If you changed the local customer password, use your replacement
          instead. Select Test Connection. For a login failure, recheck the
          label, letter case and accidental spaces. If it still fails or the
          password is unknown, ask your installer or Tesla Support about the
          Gateway's local customer login. Do not factory-reset it for this
          setup. A connection timeout instead needs an IP/network check from the
          ChargeHA server.
        </p>
        <p>
          Other Gateway models are not verified by this plugin; do not assume
          these password instructions apply. See{" "}
          <a
            href="https://docs.netzero.energy/docs/diagnostics/Powerwall2#credentials"
            target="_blank"
            rel="noopener noreferrer"
          >
            Netzero's local-password explanation
          </a>. You do not need to change Wi-Fi settings to use this plugin.
        </p>
      </details>
    </Text>
  );
}
