import { Callout } from "@radix-ui/themes";

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
        localhost. Either open ChargeHA via localhost or https, or go back to
        the Public Key Hosting step and start the Cloudflare Tunnel — its https
        address will be used for the login instead.
      </Callout.Text>
    </Callout.Root>
  );
}
