#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { basename } from "node:path";
import { rm } from "node:fs/promises";
import { Client, serverUrl, type Me, type Entity } from "./client";
import { configPath, readConfig, saveConfig } from "./config";

const help = `Prisx CLI — HTTP API client (Bun)

  prisx login --url URL --email EMAIL --password-stdin
  prisx logout
  prisx workspaces
  prisx use WORKSPACE_ID
  prisx list [QUERY]
  prisx get ENTITY_ID
  prisx create NAME [--kind item|tag|property|class]
  prisx upload ENTITY_ID FILE [--revision NUMBER]
  prisx download ENTITY_ID [--output FILE]
  prisx history [ENTITY_ID]
  prisx export --output FILE
  prisx statement-put ENTITY_ID FILE
  prisx schema-get ENTITY_ID
  prisx schema-put ENTITY_ID FILE --revision NUMBER

FILE may be - to read JSON from stdin. Statement updates require expectedRevision in JSON.

Options: --url URL, --workspace ID, --help
JSON results go to stdout; errors go to stderr.
Config: PRISX_CONFIG or $XDG_CONFIG_HOME/prisx/config.json (~/.config by default).
Password: --password-stdin or PRISX_PASSWORD. No password is stored.
`;

export async function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      url: { type: "string" },
      email: { type: "string" },
      workspace: { type: "string" },
      kind: { type: "string" },
      output: { type: "string" },
      revision: { type: "string" },
      "password-stdin": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, ...rest] = positionals;
  if (!command || values.help) {
    console.log(help);
    return;
  }
  const arities: Record<string, [number, number]> = {
    login: [0, 0],
    logout: [0, 0],
    workspaces: [0, 0],
    use: [1, 1],
    list: [0, 1],
    get: [1, 1],
    create: [1, 1],
    upload: [2, 2],
    download: [1, 1],
    history: [0, 1],
    export: [0, 0],
    "statement-put": [2, 2],
    "schema-get": [1, 1],
    "schema-put": [2, 2],
  };
  const arity = arities[command];
  if (!arity) throw new Error(`不明なコマンド: ${command} (--help を参照)`);
  if (rest.length < arity[0] || rest.length > arity[1])
    throw new Error("引数が不正です (--help を参照)");
  const path = configPath();
  const config = await readConfig(path);
  const url = serverUrl(
    values.url ||
      process.env.PRISX_URL ||
      config?.url ||
      "http://localhost:3100",
  );
  const client = new Client(url, config?.url === url ? config.cookie : "");
  const print = (data: unknown) => console.log(JSON.stringify(data, null, 2));
  if (command === "login") {
    if (!values.email) throw new Error("--email が必要です");
    const password = values["password-stdin"]
      ? (await Bun.stdin.text()).replace(/\r?\n$/, "")
      : process.env.PRISX_PASSWORD;
    if (!password)
      throw new Error("--password-stdin または PRISX_PASSWORD が必要です");
    const me = await client.login(values.email, password);
    const workspace = values.workspace || me.workspaces[0]?.id;
    if (workspace && !me.workspaces.some((w) => w.id === workspace))
      throw new Error("ワークスペースが見つかりません");
    await saveConfig(path, { url, cookie: client.cookie, workspace });
    print({ user: me.user, workspace, url });
    return;
  }
  if (!client.cookie) throw new Error("このサーバーへ login してください");
  if (command === "logout") {
    await client.json("/api/auth/sign-out", "POST", {});
    await rm(path, { force: true });
    print({ loggedOut: true });
    return;
  }
  if (command === "workspaces" || command === "use") {
    const me = await client.json<Me>("/api/me");
    if (command === "workspaces") {
      print(me.workspaces);
      return;
    }
    if (!me.workspaces.some((w) => w.id === rest[0]))
      throw new Error("ワークスペースが見つかりません");
    await saveConfig(path, { url, cookie: client.cookie, workspace: rest[0] });
    print({ workspace: rest[0] });
    return;
  }
  const workspace = values.workspace || config?.workspace;
  if (!workspace)
    throw new Error(
      "--workspace または use でワークスペースを指定してください",
    );
  const route = (suffix: string) => client.route(workspace, suffix);
  const entity = () => client.entityRoute(workspace, rest[0]);
  const readObject = async (file: string): Promise<Record<string, unknown>> => {
    const text = await (file === "-" ? Bun.stdin : Bun.file(file)).text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("入力ファイルは有効な JSON にしてください");
    }
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error("入力は JSON オブジェクトにしてください");
    return data as Record<string, unknown>;
  };
  const requireRevision = (value: unknown): number => {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
      throw new Error("編集対象のリビジョン（0 以上の整数）を指定してください");
    return value;
  };
  switch (command) {
    case "statement-put": {
      const input = await readObject(rest[1]);
      if (input.id) requireRevision(input.expectedRevision);
      print(await client.json(entity() + "/statements", "POST", input));
      break;
    }
    case "schema-get":
      print(await client.json(entity() + "/schema"));
      break;
    case "schema-put": {
      const expectedRevision = requireRevision(
        values.revision === undefined || values.revision.trim() === ""
          ? undefined
          : Number(values.revision),
      );
      const definition = await readObject(rest[1]);
      print(
        await client.json(entity() + "/schema", "PUT", {
          expectedRevision,
          definition,
        }),
      );
      break;
    }
    case "list":
      print(
        await client.json(
          route("/entities") + "?q=" + encodeURIComponent(rest[0] || ""),
        ),
      );
      break;
    case "get":
      print(await client.json(entity()));
      break;
    case "create": {
      const kind = values.kind || "item";
      if (!["item", "tag", "property", "class"].includes(kind))
        throw new Error("--kind が不正です");
      print(
        await client.json<Entity>(route("/entities"), "POST", {
          name: rest[0],
          kind,
        }),
      );
      break;
    }
    case "upload": {
      const file = Bun.file(rest[1]);
      if (!(await file.exists()))
        throw new Error(`ファイルがありません: ${rest[1]}`);
      const revision =
        values.revision === undefined ? undefined : Number(values.revision);
      if (
        revision !== undefined &&
        (!Number.isSafeInteger(revision) || revision < 0)
      )
        throw new Error("--revision は 0 以上の整数です");
      print(
        await client.upload(
          workspace,
          rest[0],
          file,
          basename(rest[1]),
          revision,
        ),
      );
      break;
    }
    case "download": {
      const response = await client.request(entity() + "/content");
      if (values.output) await Bun.write(values.output, response);
      else await Bun.write(Bun.stdout, response);
      break;
    }
    case "history":
      print(
        await client.json(rest[0] ? entity() + "/history" : route("/history")),
      );
      break;
    case "export": {
      if (!values.output) throw new Error("--output が必要です");
      await Bun.write(values.output, await client.request(route("/export")));
      break;
    }
  }
}
if (import.meta.main)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
