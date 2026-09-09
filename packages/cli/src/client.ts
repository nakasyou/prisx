export type Workspace = { id: string; name: string };
export type Me = {
  user: { id: string; name: string; email: string };
  workspaces: Workspace[];
};
export type Entity = {
  id: string;
  name: string;
  kind: string;
  revision: number;
};
export type Detail = {
  entity: Entity;
  content: null | { revision: number };
  statements: unknown[];
};

export function serverUrl(value: string): string {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("サーバー URL は http(s)://host[:port] を指定してください");
  return url.origin;
}

export class Client {
  readonly url: string;
  constructor(
    url: string,
    public cookie = "",
  ) {
    this.url = serverUrl(url);
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookie) headers.set("Cookie", this.cookie);
    // Never forward the session to a redirect destination.
    const response = await fetch(this.url + path, {
      ...init,
      headers,
      redirect: "error",
    });
    if (!response.ok) {
      const body = await response.text();
      let message = body;
      try {
        const data = JSON.parse(body);
        message = data.error || data.message || body;
      } catch {}
      throw new Error(`HTTP ${response.status}: ${message}`);
    }
    return response;
  }

  async json<T = unknown>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    return (
      await this.request(path, {
        method,
        headers:
          body === undefined ? {} : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    ).json() as Promise<T>;
  }

  async login(email: string, password: string) {
    const response = await this.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: this.url },
      body: JSON.stringify({ email, password }),
    });
    this.cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    if (!this.cookie)
      throw new Error("サーバーからセッション Cookie が返りませんでした");
    return this.json<Me>("/api/me");
  }

  route(workspace: string, suffix: string) {
    return `/api/w/${encodeURIComponent(workspace)}${suffix}`;
  }
  entityRoute(workspace: string, id: string) {
    return this.route(workspace, `/entities/${encodeURIComponent(id)}`);
  }

  async upload(
    workspace: string,
    id: string,
    bytes: Blob,
    filename: string,
    revision?: number,
  ) {
    const path = this.entityRoute(workspace, id);
    const expected =
      revision ?? (await this.json<Detail>(path)).content?.revision ?? 0;
    return (
      await this.request(path + "/content", {
        method: "PUT",
        body: bytes,
        headers: {
          "Content-Type": bytes.type || "application/octet-stream",
          "X-Filename": encodeURIComponent(filename),
          "X-Expected-Revision": String(expected),
          "Idempotency-Key": crypto.randomUUID(),
        },
      })
    ).json();
  }
}
