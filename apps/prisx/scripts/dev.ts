const server = Bun.spawn(["bun", "--hot", "server/index.ts"], {
  stdout: "inherit",
  stderr: "inherit",
});
const web = Bun.spawn(["bunx", "vite", "--host", "127.0.0.1"], {
  stdout: "inherit",
  stderr: "inherit",
});
function stop() {
  server.kill();
  web.kill();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await Promise.race([server.exited, web.exited]);
stop();
