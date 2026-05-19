# 薬剤データバンドル — 「ファイルを入れるだけで全実装」

`data/` が **全薬剤情報をまとめた正本**。空のカルテでも下記1コマンドで全実装される。

```
pnpm import:drugs:bundle           # data/ を検証付き・冪等で全投入
pnpm export:drugs:bundle           # 現DBの全薬剤情報を data/ に書き出す（再生成）
```

実証済: 薬剤テーブルを空(0件)にして `import:drugs:bundle` → DB件数がバンドルと完全一致
（製品150/成分140/適応101/禁忌/相互/用量、安全skip 0＝provenance全通過）。

## 中身（`data/`）

| ファイル | 内容 | キー |
|---|---|---|
| `manifest.json` | 版・生成日時・各CSV件数 | — |
| `drug_ingredient.csv` | 成分 | ingredientCode |
| `drug_product.csv` | 製品（コード/名称/規格/剤形/薬価/ATC/成分） | receiptCode |
| `drug_indication.csv` | 適応（ICD10・保険適用） | targetType,targetCode |
| `drug_contraindication.csv` | 禁忌（重症度/条件/ICD10/年齢） | targetType,targetCode |
| `drug_interaction.csv` | 相互作用（相手/重症度/機序/対応） | subjectType,subjectCode |
| `drug_dosage.csv` | 用法用量・極量 | targetType,targetCode |

安全系CSV（適応/禁忌/相互/用量）は全行に **source / sourceCitation / isProvisional /
reviewedBy** 必須。`source` は `DrugDataSource`（AI不在）。CURATED_SEED /
PHARMACIST_VERIFIED は reviewedBy 必須。違反行は取込時 skip＋errorに記録（捏造混入を防止）。

## いまの中身と、全保険品目への到達

- 現状: 頻用 **150製品 / 140成分**＋検証済み安全データ（CURATED_SEED 暫定）。
- **全約2万品目（コード/薬価/名称）**: 公的マスタを一度取込めば全件になる。
  ```
  pnpm import:drugs /path/to/医薬品マスター.zip 2026-04   # 厚労省/支払基金 y マスタ
  pnpm export:drugs:bundle                                  # → data/ が全件版に再生成
  ```
- **安全データ（禁忌/相互/極量/効能）の網羅**: PMDA電子添文XML（無料・要構造化）または
  商用DB（JAPIC等・要ライセンス）を取込み、薬剤師レビューで PHARMACIST_VERIFIED 昇格。
  **AI/手動推測での安全データ生成は不可**（本バンドルは provenance で物理的に拒否）。

→ 運用: 「公式/商用ファイルを入手 → 取込 → `export:drugs:bundle` で `data/` を全件版に
更新 → 以後はその `data/` を入れるだけ」。フォーマット・取込・検証は確定済み、件数は
出典ファイル次第。

## 取込の不変条件
- 冪等：成分/製品は自然キー upsert。安全データは追記専用（再取込は新規環境に対して実施）。
- 公的層（コード/薬価）と安全層を分離。公的層は無加工で投入。
- provenance 検証を通らない安全行は適用せず errors に記録。
