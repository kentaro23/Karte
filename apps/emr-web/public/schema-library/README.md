# 人体図シェーマライブラリ（schema-library）

FR-CHT-04（要件定義書 §5.3）／174項 17「シェーマ」の **人体図ライブラリ** 用の静的アセット。
`/chart/schema` 画面（`SchemaCanvas`）の背景として名前検索→選択され、その上から手描き注釈を加えて
`NoteAttachment(kind=SCHEMA, libraryRef=<このファイル名>)` として保存される。

## 収録図（簡易SVGライン画）

| ファイル | 名称 | 検索キーワード例 |
|---|---|---|
| `body-front.svg` | 全身（前面） | 全身, 前面, ぜんしん, body, front, zenshin |
| `body-back.svg` | 全身（背面） | 全身, 背面, せなか, back, spine, senaka |
| `head.svg` | 頭部（正面） | 頭部, 顔, あたま, head, face, atama |
| `eye-nose.svg` | 眼・鼻部 | 眼, 目, 鼻, がん, び, eye, nose, me |
| `mouth.svg` | 口腔・口元 | 口, 口腔, 歯, くち, mouth, oral, kuchi, ha |
| `abdomen.svg` | 腹部（4分割） | 腹部, お腹, RUQ, LUQ, RLQ, LLQ, abdomen, fukubu, onaka |
| `chest.svg` | 胸部（前面） | 胸部, 胸, むね, chest, thorax, mune, kyoubu |

> 各図のメタデータ（表示名・キーワード・領域分類）は画面側の `SCHEMA_LIBRARY` 定数
> （`apps/emr-web/src/app/(emr)/chart/schema/page.tsx`）に同期している。**図を追加・改名した場合は
> その定数も更新すること。**

## 仕様メモ

- 座標系は `viewBox` 基準。`SchemaCanvas` は `object-contain` で背景配置するため縦横比は自由。
- 配色は淡いグレー線画（`#5b6b7a`）。注釈ペン（赤/青/緑/黒）が背景に埋もれないよう低彩度に統一。
- 個人情報・実写真は含めない（汎用ライン画のみ）。院内カスタム図を足す場合も同方針。
- ライセンス上の制約がない自作SVG。差し替え・追加は自由。

## 追加手順

1. 本フォルダに `<id>.svg`（白背景・グレー線画）を追加。
2. `page.tsx` の `SCHEMA_LIBRARY` に `{ id, name, region, keywords }` を1件追加。
3. 検索ボックスで `name`／`keywords` がヒットすることを確認。
