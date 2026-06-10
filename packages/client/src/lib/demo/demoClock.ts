import { getDemoState } from "./demoState.ts";

/**
 * "Now" for the demo simulation: the current wall-clock time in the demo's
 * configured timezone, returned as a Date whose *local* fields read as that
 * zone's time — so minuteOfDay()/getDay()/getHours() follow the selected
 * timezone rather than the viewer's browser. Falls back to real local time when
 * no timezone is configured.
 */
export const demoNow = (base: Date = new Date()): Date => {
  const tz = getDemoState().config.timezone;
  if (!tz) return base;
  return new Date(base.toLocaleString("en-US", { timeZone: tz }));
};
