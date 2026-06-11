/** All IANA timezones supported by the browser, with a small fallback list. */
export function getTimezones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [
      "UTC",
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "Europe/London",
      "Europe/Berlin",
      "Europe/Paris",
      "Asia/Tokyo",
      "Asia/Shanghai",
      "Australia/Sydney",
      "Australia/Melbourne",
      "Pacific/Auckland",
    ];
  }
}

/** Current UTC offset for a zone, e.g. "GMT+10:00" ("" if unsupported). */
function utcOffsetLabel(tz: string, now: Date): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "longOffset",
    }).formatToParts(now).find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

/** IANA zones labelled with their UTC offset, e.g. "Australia/Sydney (GMT+10:00)". */
export function buildTimezoneOptions(): { value: string; label: string }[] {
  const now = new Date();
  return getTimezones().map((tz) => {
    const offset = utcOffsetLabel(tz, now);
    return { value: tz, label: offset ? `${tz} (${offset})` : tz };
  });
}
