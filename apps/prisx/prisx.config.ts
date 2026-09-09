import { defineConfig, file, sqlite } from "./server/adapters";
export default defineConfig({
  host: "127.0.0.1",
  port: 3100,
  appUrl: "http://localhost:3100",
  maxUploadBytes: 100 * 1024 * 1024,
  relationalAdaptor: sqlite({ path: "data/prisx.sqlite" }),
  objectAdaptor: file({ dir: "data/objects" }),
});