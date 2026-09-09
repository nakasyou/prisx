# Prisx

Markdown ノートと根拠付きの構造化データを管理するアプリと、HTTP API に接続する CLI の Bun monorepo です。

```text
apps/prisx/    Solid + Bun API、データ保存、アプリのテスト
packages/cli/ Bun で動くコマンドラインクライアント
```

## 開発

```sh
bun install
bun run dev
```

画面は http://localhost:5173、API は http://localhost:3100 です。画面からアカウントを作成してください。

```sh
bun run build      # アプリと CLI のビルド
bun start          # ビルド済み画面と API を配信
bun run typecheck  # 両 workspace の型チェック
bun run test       # 両 workspace のテスト
bun run cli --help
```

サーバー設定はアプリの `prisx.config.ts` に書きます（アダプタは `relationalAdaptor: sqlite()`、`objectAdaptor: s3(...)` のように指定）。環境変数ファイルは `apps/prisx/.env`、既定の永続データは `apps/prisx/data/`、画面のビルド先は `apps/prisx/dist/` です。既存の `data/` は配置変更とともに移動しています。相対パスはアプリのディレクトリを基準にします。

詳しくは [アプリの README](apps/prisx/README.md)、[実装状況](apps/prisx/IMPLEMENTATION.md)、[CLI の README](packages/cli/README.md) を参照してください。

## CLI

CLI はサーバーの HTTP API を使用し、データベースを直接読み書きしません。Bun が必要です。

```sh
# パスワードを履歴に残さず入力（Bash）
read -rs -p 'Password: ' prisx_password
printf '%s' "$prisx_password" | bun run cli login --url http://localhost:3100 --email you@example.com --password-stdin
unset prisx_password

bun run cli workspaces
bun run cli use WORKSPACE_ID
bun run cli list 'tag:研究'
bun run cli create '新しいノート'
bun run cli upload ENTITY_ID ./note.md
bun run cli get ENTITY_ID
bun run cli download ENTITY_ID --output ./saved.md
bun run cli logout
```
