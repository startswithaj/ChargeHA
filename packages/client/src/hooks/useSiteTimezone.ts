import { useSystemConfig } from "./useSectionConfig.ts";

export function useSiteTimezone(): string {
  const { data } = useSystemConfig();
  return data?.timezone || "UTC";
}
