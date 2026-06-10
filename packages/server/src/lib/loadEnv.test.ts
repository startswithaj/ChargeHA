import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { loadEnv } from "./loadEnv.ts";

describe("loadEnv", () => {
  const KEY = "CHARGEHA_TEST_LOAD_ENV";

  it("exports variables from the given .env file into the process env", async () => {
    const path = `${import.meta.dirname}/loadEnv.fixture.env`;
    await Deno.writeTextFile(path, `${KEY}=loaded-from-file\n`);
    Deno.env.delete(KEY);
    try {
      await loadEnv(path);
      expect(Deno.env.get(KEY)).toBe("loaded-from-file");
    } finally {
      Deno.env.delete(KEY);
      await Deno.remove(path);
    }
  });

  it("does not throw when the .env file is absent", async () => {
    await loadEnv(`${import.meta.dirname}/does-not-exist.env`);
  });

  it("wires .env loading in main.ts before bootstrap", async () => {
    // Guards the regression where a restructure dropped .env loading entirely,
    // leaving ENCRYPTION_KEY (which has no code default) unset.
    const src = await Deno.readTextFile(
      new URL("../main.ts", import.meta.url),
    );
    expect(src).toContain("loadEnv()");
  });
});
