import { mkdir, readFile, writeFile, chmod, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
export type Config = { url: string; cookie: string; workspace?: string };
export function configPath() {
  return (
    process.env.PRISX_CONFIG ||
    join(
      process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
      "prisx",
      "config.json",
    )
  );
}
export async function readConfig(path: string): Promise<Config | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error: any) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}
export async function saveConfig(path: string, config: Config) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(config, null, 2) + "\n", {
    mode: 0o600,
  });
  await chmod(temp, 0o600);
  await rename(temp, path);
}
