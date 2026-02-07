import { Logger } from "../lib/Logger.ts";

export class CapturingLogger extends Logger {
  errors: Array<{ msg: string; args: unknown[] }> = [];

  constructor(name = "Test", level: "error" | "info" | "debug" = "error") {
    super(name, level);
  }

  override error(msg: string, ...args: unknown[]): void {
    this.errors.push({ msg, args });
  }
}
