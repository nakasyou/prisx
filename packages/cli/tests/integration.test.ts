import { test, expect } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serverUrl } from "../src/client";

test("reject credentials and non-HTTP server URLs", () => {
  expect(() => serverUrl("https://user:password@example.com")).toThrow();
  expect(() => serverUrl("file:///tmp/test")).toThrow();
  expect(() => serverUrl("https://example.com/path")).toThrow();
});

test("CLI session, workspace, search, binary roundtrip, conflict and logout", async () => {
  const dir = await mkdtemp(join(tmpdir(), "prisx-cli-"));
  const port = Bun.serve({ port: 0, fetch: () => new Response() });
  const base = `http://localhost:${port.port}`;
  const number = String(port.port);
  await port.stop(true);
  const proc = Bun.spawn(["bun", "server/index.ts"], {
    cwd: resolve(import.meta.dir, "../../../apps/prisx"),
    env: {
      ...process.env,
      PORT: number,
      APP_URL: base,
      DATA_DIR: join(dir, "data"),
    },
    stdout: "ignore",
    stderr: "ignore",
  });
  const config = join(dir, "config.json");
  const cli = async (args: string[], password?: string, success = true) => {
    const child = Bun.spawn(
      ["bun", resolve(import.meta.dir, "../src/index.ts"), ...args],
      {
        env: {
          ...process.env,
          PRISX_CONFIG: config,
          PRISX_URL: base,
          PRISX_PASSWORD: "",
        },
        stdin: password === undefined ? "ignore" : new Blob([password]),
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (success && code !== 0) throw new Error(stderr);
    if (!success) expect(code).not.toBe(0);
    return { stdout, stderr };
  };
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        await fetch(base);
        ready = true;
        break;
      } catch {
        await Bun.sleep(50);
      }
    }
    if (!ready) throw new Error("server did not start");
    expect(
      (
        await fetch(base + "/api/auth/sign-up/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "CLI Test",
            email: "cli@example.com",
            password: "test-password-123",
          }),
        })
      ).status,
    ).toBe(200);
    await cli(
      ["login", "--email", "cli@example.com", "--password-stdin"],
      "wrong-password\n",
      false,
    );
    await cli(
      ["login", "--email", "cli@example.com", "--password-stdin"],
      "test-password-123\n",
    );
    expect((await stat(config)).mode & 0o777).toBe(0o600);
    const workspaces = JSON.parse((await cli(["workspaces"])).stdout);
    await cli(["use", workspaces[0].id]);
    const created = JSON.parse((await cli(["create", "CLI ノート"])).stdout);
    const results = JSON.parse((await cli(["list", "CLI ノート"])).stdout);
    expect(results.some((e: any) => e.id === created.id)).toBe(true);
    const property = JSON.parse(
      (await cli(["create", "CLI property", "--kind", "property"])).stdout,
    );
    const definition = JSON.stringify({
      enforcement: "strict",
      valueKind: ["scalar"],
    });
    await cli(["schema-put", property.id, "-", "--revision", "0"], definition);
    expect(
      JSON.parse((await cli(["schema-get", property.id])).stdout).revision,
    ).toBe(1);
    expect(
      (
        await cli(
          ["schema-put", property.id, "-", "--revision", "0"],
          definition,
          false,
        )
      ).stderr,
    ).toContain("409");
    await cli(["schema-put", property.id, "-"], definition, false);
    const statementInput = {
      propertyId: property.id,
      value: { kind: "scalar", value: "first" },
      rank: "normal",
      qualifiers: [],
      validTime: { kind: "timeless" },
    };
    const statementFile = join(dir, "statement.json");
    await Bun.write(statementFile, JSON.stringify(statementInput));
    const statement = JSON.parse(
      (await cli(["statement-put", created.id, statementFile])).stdout,
    );
    const update = {
      ...statementInput,
      id: statement.id,
      expectedRevision: statement.revision,
      value: { kind: "scalar", value: "updated" },
    };
    await cli(["statement-put", created.id, "-"], JSON.stringify(update));
    expect(
      (
        await cli(
          ["statement-put", created.id, "-"],
          JSON.stringify(update),
          false,
        )
      ).stderr,
    ).toContain("409");
    await cli(
      ["statement-put", created.id, "-"],
      JSON.stringify({ ...update, expectedRevision: undefined }),
      false,
    );
    await cli(["statement-put", created.id, "-"], "[]", false);
    await cli(["statement-put", created.id, "-"], "{broken", false);
    const detail = JSON.parse((await cli(["get", created.id])).stdout);
    expect(
      detail.statements.find((s: any) => s.id === statement.id).value.value,
    ).toBe("updated");
    const bytes = new Uint8Array([0, 1, 2, 255, 128]);
    const source = join(dir, "sample.bin"),
      output = join(dir, "download.bin");
    await Bun.write(source, bytes);
    await cli(["upload", created.id, source]);
    await cli(["download", created.id, "--output", output]);
    expect(new Uint8Array(await Bun.file(output).arrayBuffer())).toEqual(bytes);
    expect(
      (
        await cli(
          ["upload", created.id, source, "--revision", "0"],
          undefined,
          false,
        )
      ).stderr,
    ).toContain("409");
    expect(
      JSON.parse((await cli(["get", created.id])).stdout).content.revision,
    ).toBe(1);
    expect(
      JSON.parse((await cli(["history", created.id])).stdout).length,
    ).toBeGreaterThan(0);
    const archive = join(dir, "archive.json");
    await cli(["export", "--output", archive]);
    expect((await Bun.file(archive).json()).format).toBe("prisx");
    await cli(["logout"]);
    expect(await Bun.file(config).exists()).toBe(false);
    await cli(["list"], undefined, false);
  } finally {
    proc.kill();
    await proc.exited;
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);
