import { useRef, useState } from "react";
import { trpc } from "./trpc.ts";
import {
  type Powerwall2LocalValues,
  valuesFrom,
} from "./Powerwall2LocalFields.ts";
import { Powerwall2LocalView } from "./Powerwall2LocalView.tsx";

export function Powerwall2LocalForm(
  { initial, onTestSuccess }: {
    initial: Powerwall2LocalValues;
    onTestSuccess: (values: Powerwall2LocalValues | null) => void;
  },
): JSX.Element {
  const [values, setValues] = useState(initial);
  const revision = useRef(0);
  const test = trpc.plugin.energy.powerwall2_local.testConnection
    .useMutation();
  const input = valuesFrom(values);
  const onChange = (key: string, value: string) => {
    revision.current++;
    setValues((current) => ({ ...current, [key]: value }));
    test.reset();
    onTestSuccess(null);
  };
  const onTest = () => {
    const testedRevision = revision.current;
    onTestSuccess(null);
    test.mutate(input, {
      onSuccess: (result) => {
        if (
          result.success && revision.current === testedRevision
        ) onTestSuccess(input);
      },
    });
  };
  return (
    <Powerwall2LocalView
      values={input}
      onChange={onChange}
      onTest={onTest}
      pending={test.isPending}
      disabled={!input.host || !input.password}
      result={test.isSuccess ? test.data : undefined}
      error={test.isError ? test.error.message : undefined}
    />
  );
}
