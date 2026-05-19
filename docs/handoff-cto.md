# CTO ハンドオフ — フロント/バックエンド分担

**前提**: フロント（UI・画面・操作フロー）は実装済み。動くフルスタック版をそのまま引渡す。
CTO はこの上で **本番バックエンド**を担当（下記スコープ）。フロント側は契約を切らず現状の
サーバーアクション/Prisma 直叩き構成のまま（＝壊さず置換していく方針）。

## いま動いているもの（フロント側・実装済み）

- Next.js 15 App Router / TS / pnpm+Turborepo monorepo、全28ルート・型0・本番ビルド可
- 画面: 患者選択8タブ／カルテ3ペイン(SOAP・版数・シェーマ・付箋・代行)／オーダコンソール／
  処方安全チェックUI／病名・適応薬リコメンド／受付・予約・外来／入退院・病床・看護／
  会計・マスタ・監査・利用者権限・院内掲示板・ポータル
- 動く参照実装として: 認証/セッション、RBAC+患者ACL、追記専用＋監査ハッシュ連鎖、
  処方安全エンジン(禁忌/相互/重複/極量/アレルギー)、適応リコメンド、薬剤150品目＋取込導線

## FE / BE の境界（現在のコード上の位置）

| 層 | 場所 | 所有 |
|---|---|---|
| 画面・UI | `apps/emr-web/src/app/**`（RSC/Client）、`packages/ui` | フロント |
| サーバーアクション（FE↔BEの実質API境界） | `apps/emr-web/src/app/(emr)/**/actions.ts`, `login/actions.ts`, `_actions.ts` | 境界・CTO要確認 |
| ドメイン（framework-free） | `packages/domain`（状態機械・版管理・ID） | 共有 |
| データ層 | `packages/db`（Prisma schema/migration/トリガ）, `db/triggers.sql` | **CTO** |
| 認証/認可/監査 | `packages/auth` `packages/authz` `packages/audit` | **CTO** |
| 安全エンジン/マスタ | `packages/rule-engine` `order-checks` `master-import` | 共有（データはCTO） |
| 外部連携シーム | `packages/interop`（stub先行） | **CTO** |

> サーバーアクションが事実上のAPI境界。CTOはアクションのシグネチャを保ったまま内部実装
> （DB/認証/連携）を本番化すれば、画面を書き換えずに置換できる。

## CTO バックエンド・スコープ（本番化TODO）

1. **DB/インフラ**: 開発の自己完結Postgres(trust認証/`fsync=off`)→マネージドPostgreSQL。
   接続/プール/マイグレーション運用、バックアップ/PITR、WORM保存(確定版)、リテンション
   (診療録5年/特定生物由来20年)。
2. **認証/セキュリティ**: scrypt→**Argon2id**、`AUTH_SECRET`等のシークレット管理(KMS/Secrets)、
   セッション堅牢化、二要素の本結線、レート制限、監査の改ざん検知運用、
   3省2ガイドライン/個情法/次世代医療基盤法 適合、脆弱性診断。
3. **マスタ/安全データ**: 公的レセ電 医薬品マスター全約2万品目取込（`pnpm import:drugs`、
   `docs/drug-master-import.md`）、PMDA添付文書 構造化(禁忌/相互/極量/適応)を薬剤師レビュー
   フローで昇格（provenance厳格・AI非生成の原則は不可侵）。
4. **外部連携(interop 実装)**: オンライン資格確認、レセプト電算/ORCA、電子処方箋、
   SS-MIX2、HL7 FHIR JP Core、部門システム(検査/画像 DICOM 等)。
5. **非機能**: デプロイ/CI-CD、可観測性(ログ/メトリクス/トレース)、性能、BCP/DR、
   マルチテナント、E2E/負荷/セキュリティテスト。
6. **未深掘り機能のBE**: 病床移動シミュレーション、クリティカルパス、褥瘡DESIGN-R、
   DPC様式1、保険算定（FEは枠/導線を提示済み。モデル拡張＋画面詰めは協働）。

## 起動・検証（CTO）

```
bash scripts/setup.sh        # or: DB=docker bash scripts/setup.sh
pnpm dev                     # http://localhost:3000  doctor / Medixus#2026
pnpm verify                  # 認証・監査連鎖・追記専用・安全チェックの整合
pnpm -r typecheck
```
- 仕様トレース: `docs/traceability-174.md`
- 設計の背景: 作業フォルダの `Medixus_OS_設計書.html`（M01–M12 / AI責任境界）
- 既知の運用注意: `pnpm dev` 稼働中に `pnpm build` を実行しない（`.next`共有で破損→
  画面無装飾化）。崩れたら `pnpm dev:clean`。
