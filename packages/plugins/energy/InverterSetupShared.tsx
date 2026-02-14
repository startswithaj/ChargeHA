import { Badge, Text } from "@radix-ui/themes";
import { CheckCircle, XCircle } from "lucide-react";

export type TestStatus =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "success"; detail?: string }
  | { status: "error"; message: string };

export type FroniusDevice = { host: string; name: string; model: string };

export function TestResultBadge(
  { testResult }: { testResult: TestStatus },
): JSX.Element | null {
  if (testResult.status === "success") {
    return (
      <Badge color="green" size="2">
        <CheckCircle size={14} />
        Connected{testResult.detail ? ` — ${testResult.detail}` : ""}
      </Badge>
    );
  }
  if (testResult.status === "error") {
    return (
      <Text size="2" color="red">
        <XCircle
          size={14}
          style={{
            display: "inline",
            verticalAlign: "middle",
            marginRight: 4,
          }}
        />
        {testResult.message}
      </Text>
    );
  }
  return null;
}
