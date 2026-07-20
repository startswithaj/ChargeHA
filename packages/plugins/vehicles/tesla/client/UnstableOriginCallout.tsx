import { Callout, Code, Text } from "@radix-ui/themes";

function forwardCommand(browserOrigin: string): string {
  const url = new URL(browserOrigin);
  const port = url.port || "80";
  return `ssh -L 8000:localhost:${port} ${url.hostname}`;
}

/** Shown when Tesla login can't proceed: the browser address can't be
 *  registered in Tesla's portal and no tunnel is running to stand in. */
export function UnstableOriginCallout(
  { browserOrigin }: { browserOrigin: string },
) {
  return (
    <Callout.Root color="red">
      <Callout.Text>
        Tesla login needs a redirect address that can be registered in the Tesla
        Developer Portal. Your current address <strong>{browserOrigin}</strong>
        {" "}
        can't be registered — the portal rejects plain http addresses other than
        localhost. Your options:
        <Text as="p" size="2" style={{ marginTop: 8 }}>
          1. Go back to the Public Key Hosting step and start the tunnel — its
          https address is used for the login instead. If the developer portal
          won't accept the tunnel's URLs, Tesla has blocked the tunnel provider
          and you'll need one of the options below.
        </Text>
        <Text as="p" size="2" style={{ marginTop: 4 }}>
          2. Open ChargeHA via localhost instead. Run this in a terminal on the
          computer you're browsing from — it connects to the ChargeHA server
          over ssh and makes it reachable at localhost on your machine (add{" "}
          <Code size="1">user@</Code>{" "}
          before the address if your username differs on the server):
        </Text>
        <Text as="p" size="2" style={{ marginTop: 4 }}>
          <Code size="1">{forwardCommand(browserOrigin)}</Code>
        </Text>
        <Text as="p" size="2" style={{ marginTop: 4 }}>
          Keep it running and continue setup at{" "}
          <Code size="1">http://localhost:8000</Code>{" "}
          — localhost addresses can be registered with Tesla.
        </Text>
        <Text as="p" size="2" style={{ marginTop: 4 }}>
          3. Serve ChargeHA over https on a real domain.
        </Text>
      </Callout.Text>
    </Callout.Root>
  );
}
