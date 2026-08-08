// The one "did the test pass" readout, shared by every plugin with a Test
// Connection button. Lived under energy/ while inverters were the only thing
// worth testing; chargers test the same way, and a second copy would drift.
//
// Imports nothing from hostUi.ts — hostUi re-exports this, and componentRegistry
// imports hostUi, so pulling hostUi in here would close a cycle. See the
// dependency rules in docs/code.md.
import { Badge, Text } from "@radix-ui/themes";
import { CheckCircle, XCircle } from "lucide-react";

export type TestStatus =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "success"; detail?: string }
  | { status: "error"; message: string };

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
