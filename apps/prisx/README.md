# Prisx

タグと主張を中心に情報を編集する、Bun / Solid の Web アプリケーション。

**仕様 v1.0 の初期実装です。全項目の完成版ではありません。** 実装範囲と残りの作業は [実装状況](./IMPLEMENTATION.md) を参照してください。受領した仕様は第13章のテーブル一覧途中までです。

## 起動

```sh
bun install
bun run dev
```

開発画面: http://localhost:5173 。Bun API は http://localhost:3100 。最初に画面からアカウントを作成します。個人用ワークスペースと組み込み語彙が作成されます。

ビルドした画面を Bun から配信する場合:

```sh
bun run build
bun start
```

http://localhost:3100 を開きます。既定はループバックアドレスのみで待ち受けます。公開環境では `prisx.config.ts` で `appUrl`、`authSecret` を設定し、TLS、永続ディスクを用意してください。

```sh
bun test
bun run typecheck
```

## 操作

Markdown は CodeMirror 6 のライブプレビューで直接編集します。見出し・太字・引用などを装飾表示し、編集中の行では Markdown 記号を表示します。ツールバーから書式を挿入でき、ソース表示へ切り替えても同じ EditorView と Undo 履歴を維持します。

- 左リボンの `＋`: Markdown、ファイルを持たない概念、タグ、キー、クラスを作成。
- アップロードボタン、またはファイルのドロップで任意ファイルを保存。
- エンティティ上部のデータ欄でキー・値を追加。同じキーの `＋` で独立した主張を追加。
- 値のクリックで編集。行のクリックで右側に証拠・評価を表示。
- エンティティ操作メニューからキー・クラスのスキーマを JSON で定義。
- `Mod+O`: クイックオープン、`Mod+P`: コマンド、`Mod+S`: 保存、`Mod+Shift+T`: 閉じたタブの復元。
- 設定から完全エクスポート、空ワークスペースへの再インポート、Wikidata の Q ID 指定取り込み。
- 保存状態が「競合」の場合はクリックして、最新版と編集中の本文を比較・編集して新しい版として保存。

本文は約800msで自動保存します。IME変換中は確定を待ちます。未保存本文を IndexedDB に保持し、再読込時に版を比較して復旧します。

## 保存構成

```text
src/domain.ts          型付き Value、Statement、Query と純粋関数
src/time.ts            精度・タイムゾーン・三値判定
src/constraints.ts     共有値／JSON Schema 検証
src/handlers.ts        コンテンツ処理 capability
server/repository.ts   drizzle-sqlite アダプタと操作トランザクション
server/schema.ts       Drizzle スキーマ（認証と内容を論理分離）
server/adapters.ts     sqlite() / file() / s3() アダプタ
server/config.ts       prisx.config.ts の読込と環境変数フォールバック
server/db.ts           初期 SQL migration、WAL、FTS5
server/storage.ts      file-storage / s3-compat 実装
server/markdown.ts     Markdown AST によるタグ・リンク抽出
server/archive.ts      全版・ファイルのエクスポート／再インポート
server/index.ts        Better Auth、認可、HTTP API、composition root
```

`prisx.config.ts` が起動時に読み込まれます。`relationalAdaptor` と `objectAdaptor` にアダプタを指定します。`PRISX_CONFIG` でパスを上書きでき、設定ファイルが無い場合は `.env` の値で動作します。

```ts
import { defineConfig, sqlite, file } from "./server/adapters";
export default defineConfig({
  host: "127.0.0.1",
  port: 3100,
  appUrl: "http://localhost:3100",
  maxUploadBytes: 100 * 1024 * 1024,
  relationalAdaptor: sqlite({ path: "data/prisx.sqlite" }),
  objectAdaptor: file({ dir: "data/objects" }),
});
```

`sqlite({ path })` は Bun 組み込み SQLite を、`file({ dir })` はローカルファイル保存を、`s3({ endpoint, bucket, accessKeyId, secretAccessKey, ... })` は S3 互換オブジェクトストレージを返します。

`data/prisx.sqlite` に構造化データ、`data/objects/` に Markdown を含むバイト列を保存します。これらは Git 管理対象外です。単一サーバー・ローカル永続ディスクを前提とします。

`file-storage` はサーバー生成 ID を使い、不変ファイルの作成と SHA-256 を用います。データ欄だけの変更は本文を書き換えません。SQLite が指す現在のコンテンツ版は、オブジェクト保存後の DB トランザクションが成功した場合にだけ更新します。

通常の主張、出典、評価などのレコードは `records` の種別付き行として、履歴は `revisions` の追記行として保存します。重複主張を許可します。Evidence は Reference を含む独立行です。

## スキーマ定義の例

キーのスキーマ画面:

```json
{
  "enforcement": "strict",
  "valueKind": ["scalar"],
  "valueSchema": {
    "type": "object",
    "properties": {
      "kind": { "const": "scalar" },
      "value": { "type": "string", "minLength": 1 }
    },
    "required": ["kind", "value"]
  }
}
```

クラスのスキーマ画面:

```json
{
  "enabled": true,
  "enforcement": "strict",
  "closed": false,
  "requiredKeys": ["PROPERTY_ID"],
  "allowedKeys": []
}
```

`requiredKeys`、`allowedKeys` はキーの ID を使います。現在有効と確定する `instanceOf` / `subclassOf` にのみスキーマを適用します。時点未指定の分類を現在有効と推測しません。通常の分類には有効時間「時点なし」を選択できます。

## S3 互換ストレージ

`prisx.config.ts` で `objectAdaptor: s3({ endpoint, region, bucket, prefix, forcePathStyle, accessKeyId, secretAccessKey })` を指定します。既存オブジェクトは自動移行されません。新しい空の保存先へエクスポート・再インポートするか、チェックサムを保って別途移行してください。

このアダプタは Put/Get/Head/Delete と書込み後の SHA-256 照合を実装しています。非公開バケットと `If-None-Match: *` 対応が必要です。署名 URL や multipart は未実装です。実サービスとの契約試験は未実施です。

## エクスポートと復元

JSON アーカイブには、削除状態を含む全エンティティ、各種レコード、履歴、全コンテンツ版のバイト列（base64）を含みます。認証情報・セッション・ユーザーのパスワードは含めません。

再インポートは空ワークスペースを対象とし、同一 DB 内に同じ ID がある場合は競合で停止します。ID の保持が必要なためです。別 DB への復元テストで主張、履歴 ID、元ファイルの完全一致を検証しています。大規模アーカイブのストリーミング対応は未実装です。

## 参照

- [Solid lifecycle](https://docs.solidjs.com/reference/lifecycle/on-cleanup)
- [Drizzle + Bun SQLite](https://orm.drizzle.team/docs/get-started/bun-sqlite-existing)
- [Better Auth Drizzle adapter](https://better-auth.com/docs/adapters/drizzle)
- [Wikidata entity data access](https://www.wikidata.org/wiki/Help:Linked_Data_Interface)
