# @prisx/cli

既存 Prisx サーバーへ接続する Bun 用 CLI。リポジトリのルートで `bun run cli --help` を実行できます。ビルド後は `bun packages/cli/dist/index.js --help` でも実行できます。

| コマンド | 用途 |
| --- | --- |
| `login --url URL --email EMAIL --password-stdin` | 既存アカウントでログイン |
| `logout` | サーバーのセッションを無効化し、ローカル設定を削除 |
| `workspaces` / `use ID` | ワークスペース一覧・選択 |
| `list [QUERY]` | エンティティ検索 |
| `get ID` | エンティティ・主張・コンテンツ情報を取得 |
| `create NAME [--kind KIND]` | item / tag / property / class を作成 |
| `upload ID FILE [--revision N]` | 本文・任意ファイルを保存 |
| `download ID [--output FILE]` | 本文・任意ファイルを取得。省略時は標準出力 |
| `history [ID]` | ワークスペース全体またはエンティティの履歴 |
| `export --output FILE` | ワークスペースをアーカイブ |

`--workspace ID` で選択を一時的に上書きできます。サーバーは `--url`、`PRISX_URL`、保存済み設定、`http://localhost:3100` の順に決まります。URL はオリジン（例: `https://prisx.example.com`）を指定してください。別サーバーに保存済み Cookie を送ることはありません。

パスワードは `--password-stdin` または `PRISX_PASSWORD` から受け取り、保存しません。セッション Cookie・接続先・ワークスペースは `$XDG_CONFIG_HOME/prisx/config.json`（既定 `~/.config/prisx/config.json`）に権限 `0600` で保存します。`PRISX_CONFIG` でファイルを変更できます。設定は一度に一つの接続先を保持します。セッション失効時は再ログインしてください。

出力は JSON、download は元のバイト列です。エラーは標準エラーに出力し、終了コード 1 を返します。upload はアップロード直前の本文リビジョンを取得し、保存時に競合を検出します。ローカル編集開始時の版を保護したい場合は `get` の `content.revision` を `--revision` で明示してください。競合を自動上書きしません。

アカウント作成と証拠の編集は現在 Web アプリで行います。

## 主張・スキーマの編集

`statement-put ENTITY_ID FILE` で主張を作成・更新できます。FILE に `-` を渡すと標準入力から JSON を読みます。新規作成の例:

```json
{
  "propertyId": "PROPERTY_ID",
  "value": { "kind": "scalar", "value": "値" },
  "rank": "normal",
  "qualifiers": [],
  "validTime": { "kind": "timeless" }
}
```

```sh
bun run cli statement-put ENTITY_ID ./statement.json
bun run cli get ENTITY_ID
```

更新時は JSON に対象の `id` と、取得時の `revision` を `expectedRevision` として追加してください。更新でも `propertyId`・`value`・`rank`・`qualifiers`・`validTime` を含む主張全体を渡します。リビジョン省略や競合時は失敗し、自動上書きしません。

```sh
bun run cli schema-get PROPERTY_OR_CLASS_ID
bun run cli schema-put PROPERTY_OR_CLASS_ID ./definition.json --revision 0
```

`definition.json` は `{"enforcement":"strict","valueKind":["scalar"]}` のような定義本体です。`--revision` は `schema-get` が返す版を指定し、未定義の場合は `0` を使います。サーバー側の制約検証と既存主張の検証が適用されます。
