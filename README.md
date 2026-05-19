# Medixus カルテ — ローカル起動手順（CTO 向け）

病院グレード電子カルテ。Next.js 15 / TypeScript / pnpm + Turborepo monorepo / PostgreSQL + Prisma。

## 渡し方（重要）

**git リポジトリ or zip で渡す。`node_modules` `.pgdata` `.next` `.turbo` `.env` は含めない**
（`.gitignore` 済み。容量大＆OS依存バイナリ＆絶対パスを含むため。依存は各自 `pnpm install`）。

本リポジトリは未 git 初期化。いずれかで連携:
```
# 推奨: git 初期化して渡す（履歴・.gitignore が効く）
cd medixus-karte && git init && git add -A && git commit -m "init"
# → GitHub等に push、または:  git archive --format=zip -o ../medixus-karte.zip HEAD

# もしくは zip（除外を必ず指定）
cd .. && zip -r medixus-karte.zip medixus-karte \
  -x 'medixus-karte/node_modules/*' 'medixus-karte/**/node_modules/*' \
     'medixus-karte/.pgdata/*' 'medixus-karte/**/.next/*' \
     'medixus-karte/.turbo/*' 'medixus-karte/.env' 'medixus-karte/**/.env'
```

## 前提（CTO のマシンに必要なもの）

- **Node.js 20+**（推奨 v20/v22、開発は v24 で確認）
- **pnpm 10+**  … `npm i -g pnpm`
- **PostgreSQL 14+**、以下いずれか:
  - mac: `brew install postgresql@16`（Apple Silicon / Intel 両対応・自動検出）
  - Linux: `apt-get install postgresql-16` 等
  - **Docker**（OS不問・最も確実）: Docker Desktop / Engine

## 起動（2通り。どちらか）

### A. プロジェクト内蔵Postgres（mac/Linux・サービス登録不要）
```
cd medixus-karte
bash scripts/setup.sh        # env生成→pnpm install→DB初期化→migrate→triggers→seed
pnpm dev                     # → http://localhost:3000
```

### B. Docker の Postgres（OS不問・最も確実）
```
cd medixus-karte
DB=docker bash scripts/setup.sh
pnpm dev                     # → http://localhost:3000
```

手動で進める場合:
```
cp .env.example .env && cp apps/emr-web/.env.example apps/emr-web/.env
pnpm install
docker compose up -d db          # または: pnpm pg:init && pnpm pg:start
pnpm db:migrate && pnpm db:triggers && pnpm seed
pnpm dev
```

## ログイン

`http://localhost:3000` → **doctor / Medixus#2026**
（他ロール: nurse / pharma / clerk / admin、同パスワード）。
デモデータ: 患者34・入院/救急/予約・複数版カルテ・処方安全チェック・適応薬リコメンド・薬剤150品目。

## 検証コマンド

```
pnpm verify        # バックエンド整合（認証・監査ハッシュ連鎖・追記専用・安全チェック）
pnpm -r typecheck  # 型チェック
pnpm --filter @medixus/emr-web build   # 本番ビルド
```

## 全保険医薬品の取込（任意）

現状は頻用150品目。公的マスタ（要利用登録）入手後:
```
pnpm import:drugs /path/to/医薬品マスター.zip 2026-04
```
詳細は `docs/drug-master-import.md`。

## トラブルシュート

- `PostgreSQL が見つかりません` → 上記いずれかでPostgres導入、または `DB=docker` を使用
- 別のPostgresを使いたい → `scripts/pg.sh` を使わず `.env` と `apps/emr-web/.env` の
  `DATABASE_URL` を自分のDBに向け、`pnpm db:migrate && pnpm db:triggers && pnpm seed`
- ポート3000使用中 → `pnpm --filter @medixus/emr-web exec next dev -p 3001`
- **画面が無装飾（CSS崩れ）になる** → `.next` キャッシュ破損。`pnpm dev:clean` で復旧
  （ブラウザは ⌘⇧R でハードリロード）。**`pnpm dev` 稼働中に `pnpm build` を実行しない**
  （同一 `.next` を共有し壊れる）。本番確認は dev を止めてから `pnpm --filter @medixus/emr-web build`
- 仕様対応状況は `docs/traceability-174.md`
