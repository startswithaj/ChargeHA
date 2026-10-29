import type {
  PowerwallHttp,
  PowerwallHttpResponse,
} from "../PowerwallGatewayClient.ts";

interface RecordedRequest {
  path: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export class FakePowerwallHttp implements PowerwallHttp {
  readonly requests: RecordedRequest[] = [];
  closeCalls = 0;

  private readonly responses = new Map<
    string,
    (PowerwallHttpResponse | Error)[]
  >();

  close(): void {
    this.closeCalls++;
  }

  queue(path: string, ...responses: (PowerwallHttpResponse | Error)[]): this {
    this.responses.set(path, responses);
    return this;
  }

  request(
    _host: string,
    path: string,
    method: "GET" | "POST",
    headers: Record<string, string>,
    body?: string,
  ): Promise<PowerwallHttpResponse> {
    this.requests.push({ path, method, headers, body });
    const next = this.responses.get(path)?.shift();
    if (!next) throw new Error(`No fake response for ${path}`);
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }
}

export const response = (
  status: number,
  body: unknown,
  setCookies: readonly string[] = [],
): PowerwallHttpResponse => ({
  status,
  body: typeof body === "string" ? body : JSON.stringify(body),
  setCookies,
});
