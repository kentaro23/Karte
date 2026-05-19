/**
 * 頻用医療用医薬品 拡充リスト（フロント実運用感のための主要薬）。
 *
 * 名称・規格・剤形は一般名ベースの標準的記載。**安全データ（禁忌/相互作用/極量）は
 * 付与しない** — provenance厳格の原則により未整備薬は処方時「要確認 WARNING」となる
 * （＝安全側の設計通りの挙動）。完全 約2万品目は importReceiptDrugMaster() で公的
 * レセプト電算 医薬品マスター(Shift_JIS CSV) を取込めば本コードに依らず全置換される。
 */
export interface CommonDrug {
  receiptCode: string; // SEED scheme（請求非対応・公的取込で置換）
  brandName: string;
  brandNameKana: string;
  genericName: string;
  ingredientCode: string;
  ingredientName: string;
  strengthValue: number;
  strengthUnit: string;
  dosageForm: string;
  route: string;
  atcCode?: string;
}

// [generic, kana, ing, strength, unit, form, route, atc]
type Row = [string, string, string, number, string, string, string, string];

const RX: Row[] = [
  // 解熱鎮痛・NSAIDs
  ['アセトアミノフェン錠200mg', 'アセトアミノフェン', 'ING_ACETAMINOPHEN', 200, 'mg', '錠', '内服', 'N02BE01'],
  ['ロキソプロフェンNa錠60mg', 'ロキソプロフェン', 'ING_LOXOPROFEN', 60, 'mg', '錠', '内服', 'M01AE'],
  ['セレコキシブ錠100mg', 'セレコキシブ', 'ING_CELECOXIB', 100, 'mg', '錠', '内服', 'M01AH01'],
  ['ジクロフェナクNa錠25mg', 'ジクロフェナク', 'ING_DICLOFENAC', 25, 'mg', '錠', '内服', 'M01AB05'],
  ['イブプロフェン錠200mg', 'イブプロフェン', 'ING_IBUPROFEN', 200, 'mg', '錠', '内服', 'M01AE01'],
  ['トラマドール塩酸塩錠25mg', 'トラマドール', 'ING_TRAMADOL', 25, 'mg', '錠', '内服', 'N02AX02'],
  // 抗菌薬
  ['アモキシシリンカプセル250mg', 'アモキシシリン', 'ING_AMOXICILLIN', 250, 'mg', 'カプセル', '内服', 'J01CA04'],
  ['アモキシシリン・クラブラン酸配合錠', 'アモキシシリンクラブランサン', 'ING_AMOXICLAV', 250, 'mg', '錠', '内服', 'J01CR02'],
  ['セファレキシンカプセル250mg', 'セファレキシン', 'ING_CEFALEXIN', 250, 'mg', 'カプセル', '内服', 'J01DB01'],
  ['セフカペンピボキシル錠100mg', 'セフカペンピボキシル', 'ING_CEFCAPENE', 100, 'mg', '錠', '内服', 'J01DD'],
  ['レボフロキサシン錠500mg', 'レボフロキサシン', 'ING_LEVOFLOXACIN', 500, 'mg', '錠', '内服', 'J01MA12'],
  ['クラリスロマイシン錠200mg', 'クラリスロマイシン', 'ING_CLARITHROMYCIN', 200, 'mg', '錠', '内服', 'J01FA09'],
  ['アジスロマイシン錠250mg', 'アジスロマイシン', 'ING_AZITHROMYCIN', 250, 'mg', '錠', '内服', 'J01FA10'],
  ['ミノサイクリン塩酸塩錠100mg', 'ミノサイクリン', 'ING_MINOCYCLINE', 100, 'mg', '錠', '内服', 'J01AA08'],
  ['ST合剤配合錠', 'エスティーゴウザイ', 'ING_SToxazole', 1, '錠', '錠', '内服', 'J01EE01'],
  ['メトロニダゾール錠250mg', 'メトロニダゾール', 'ING_METRONIDAZOLE', 250, 'mg', '錠', '内服', 'P01AB01'],
  ['バンコマイシン塩酸塩点滴静注用0.5g', 'バンコマイシン', 'ING_VANCOMYCIN', 0.5, 'g', '注射', '注射', 'J01XA01'],
  ['セフトリアキソンNa点滴静注用1g', 'セフトリアキソン', 'ING_CEFTRIAXONE', 1, 'g', '注射', '注射', 'J01DD04'],
  // 抗ウイルス・抗真菌
  ['アシクロビル錠400mg', 'アシクロビル', 'ING_ACICLOVIR', 400, 'mg', '錠', '内服', 'J05AB01'],
  ['バラシクロビル錠500mg', 'バラシクロビル', 'ING_VALACICLOVIR', 500, 'mg', '錠', '内服', 'J05AB11'],
  ['オセルタミビルカプセル75mg', 'オセルタミビル', 'ING_OSELTAMIVIR', 75, 'mg', 'カプセル', '内服', 'J05AH02'],
  ['フルコナゾールカプセル100mg', 'フルコナゾール', 'ING_FLUCONAZOLE', 100, 'mg', 'カプセル', '内服', 'J02AC01'],
  // 降圧 ARB/ACE
  ['カンデサルタン錠8mg', 'カンデサルタン', 'ING_CANDESARTAN', 8, 'mg', '錠', '内服', 'C09CA06'],
  ['テルミサルタン錠40mg', 'テルミサルタン', 'ING_TELMISARTAN', 40, 'mg', '錠', '内服', 'C09CA07'],
  ['オルメサルタン錠20mg', 'オルメサルタン', 'ING_OLMESARTAN', 20, 'mg', '錠', '内服', 'C09CA08'],
  ['ロサルタンK錠50mg', 'ロサルタン', 'ING_LOSARTAN', 50, 'mg', '錠', '内服', 'C09CA01'],
  ['エナラプリルマレイン酸塩錠5mg', 'エナラプリル', 'ING_ENALAPRIL', 5, 'mg', '錠', '内服', 'C09AA02'],
  ['イミダプリル塩酸塩錠5mg', 'イミダプリル', 'ING_IMIDAPRIL', 5, 'mg', '錠', '内服', 'C09AA16'],
  // 降圧 CCB/利尿/β/α
  ['アムロジピン錠5mg', 'アムロジピン', 'ING_AMLODIPINE', 5, 'mg', '錠', '内服', 'C08CA01'],
  ['ニフェジピンCR錠20mg', 'ニフェジピン', 'ING_NIFEDIPINE', 20, 'mg', '錠', '内服', 'C08CA05'],
  ['ベニジピン塩酸塩錠4mg', 'ベニジピン', 'ING_BENIDIPINE', 4, 'mg', '錠', '内服', 'C08CA15'],
  ['アゼルニジピン錠16mg', 'アゼルニジピン', 'ING_AZELNIDIPINE', 16, 'mg', '錠', '内服', 'C08CA'],
  ['フロセミド錠20mg', 'フロセミド', 'ING_FUROSEMIDE', 20, 'mg', '錠', '内服', 'C03CA01'],
  ['アゾセミド錠30mg', 'アゾセミド', 'ING_AZOSEMIDE', 30, 'mg', '錠', '内服', 'C03CA'],
  ['スピロノラクトン錠25mg', 'スピロノラクトン', 'ING_SPIRONOLACTONE', 25, 'mg', '錠', '内服', 'C03DA01'],
  ['トリクロルメチアジド錠1mg', 'トリクロルメチアジド', 'ING_TRICHLORMETHIAZIDE', 1, 'mg', '錠', '内服', 'C03AA'],
  ['ビソプロロールフマル酸塩錠2.5mg', 'ビソプロロール', 'ING_BISOPROLOL', 2.5, 'mg', '錠', '内服', 'C07AB07'],
  ['カルベジロール錠10mg', 'カルベジロール', 'ING_CARVEDILOL', 10, 'mg', '錠', '内服', 'C07AG02'],
  ['ドキサゾシンメシル酸塩錠1mg', 'ドキサゾシン', 'ING_DOXAZOSIN', 1, 'mg', '錠', '内服', 'C02CA04'],
  // 脂質
  ['ロスバスタチン錠2.5mg', 'ロスバスタチン', 'ING_ROSUVASTATIN', 2.5, 'mg', '錠', '内服', 'C10AA07'],
  ['アトルバスタチン錠10mg', 'アトルバスタチン', 'ING_ATORVASTATIN', 10, 'mg', '錠', '内服', 'C10AA05'],
  ['ピタバスタチンCa錠2mg', 'ピタバスタチン', 'ING_PITAVASTATIN', 2, 'mg', '錠', '内服', 'C10AA08'],
  ['プラバスタチンNa錠10mg', 'プラバスタチン', 'ING_PRAVASTATIN', 10, 'mg', '錠', '内服', 'C10AA03'],
  ['エゼチミブ錠10mg', 'エゼチミブ', 'ING_EZETIMIBE', 10, 'mg', '錠', '内服', 'C10AX09'],
  ['フェノフィブラート錠80mg', 'フェノフィブラート', 'ING_FENOFIBRATE', 80, 'mg', '錠', '内服', 'C10AB05'],
  ['イコサペント酸エチル粒状カプセル', 'イコサペントサンエチル', 'ING_EPA', 900, 'mg', 'カプセル', '内服', 'C10AX06'],
  // 糖尿病
  ['メトホルミン塩酸塩錠250mg', 'メトホルミン', 'ING_METFORMIN', 250, 'mg', '錠', '内服', 'A10BA02'],
  ['シタグリプチンリン酸塩錠50mg', 'シタグリプチン', 'ING_SITAGLIPTIN', 50, 'mg', '錠', '内服', 'A10BH01'],
  ['リナグリプチン錠5mg', 'リナグリプチン', 'ING_LINAGLIPTIN', 5, 'mg', '錠', '内服', 'A10BH05'],
  ['ダパグリフロジン錠5mg', 'ダパグリフロジン', 'ING_DAPAGLIFLOZIN', 5, 'mg', '錠', '内服', 'A10BK01'],
  ['エンパグリフロジン錠10mg', 'エンパグリフロジン', 'ING_EMPAGLIFLOZIN', 10, 'mg', '錠', '内服', 'A10BK03'],
  ['グリメピリド錠1mg', 'グリメピリド', 'ING_GLIMEPIRIDE', 1, 'mg', '錠', '内服', 'A10BB12'],
  ['ボグリボースOD錠0.3mg', 'ボグリボース', 'ING_VOGLIBOSE', 0.3, 'mg', '口腔内崩壊錠', '内服', 'A10BF03'],
  ['インスリングラルギン注', 'インスリングラルギン', 'ING_INSULIN_GLARGINE', 300, '単位', '注射', '注射', 'A10AE04'],
  // 消化器
  ['ランソプラゾールOD錠15mg', 'ランソプラゾール', 'ING_LANSOPRAZOLE', 15, 'mg', '口腔内崩壊錠', '内服', 'A02BC03'],
  ['ラベプラゾールNa錠10mg', 'ラベプラゾール', 'ING_RABEPRAZOLE', 10, 'mg', '錠', '内服', 'A02BC04'],
  ['エソメプラゾールカプセル20mg', 'エソメプラゾール', 'ING_ESOMEPRAZOLE', 20, 'mg', 'カプセル', '内服', 'A02BC05'],
  ['ボノプラザンフマル酸塩錠20mg', 'ボノプラザン', 'ING_VONOPRAZAN', 20, 'mg', '錠', '内服', 'A02BC08'],
  ['ファモチジン錠20mg', 'ファモチジン', 'ING_FAMOTIDINE', 20, 'mg', '錠', '内服', 'A02BA03'],
  ['モサプリドクエン酸塩錠5mg', 'モサプリド', 'ING_MOSAPRIDE', 5, 'mg', '錠', '内服', 'A03FA'],
  ['メトクロプラミド錠5mg', 'メトクロプラミド', 'ING_METOCLOPRAMIDE', 5, 'mg', '錠', '内服', 'A03FA01'],
  ['ドンペリドン錠10mg', 'ドンペリドン', 'ING_DOMPERIDONE', 10, 'mg', '錠', '内服', 'A03FA03'],
  ['酸化マグネシウム錠330mg', 'サンカマグネシウム', 'ING_MGOXIDE', 330, 'mg', '錠', '内服', 'A06AD02'],
  ['センノシド錠12mg', 'センノシド', 'ING_SENNOSIDE', 12, 'mg', '錠', '内服', 'A06AB06'],
  ['ビフィズス菌配合散', 'ビフィズスキン', 'ING_BIFIDO', 1, 'g', '散', '内服', 'A07FA'],
  ['レバミピド錠100mg', 'レバミピド', 'ING_REBAMIPIDE', 100, 'mg', '錠', '内服', 'A02BX'],
  ['メサラジン錠250mg', 'メサラジン', 'ING_MESALAZINE', 250, 'mg', '錠', '内服', 'A07EC02'],
  ['ウルソデオキシコール酸錠100mg', 'ウルソデオキシコールサン', 'ING_UDCA', 100, 'mg', '錠', '内服', 'A05AA02'],
  // 呼吸器・アレルギー
  ['カルボシステイン錠500mg', 'カルボシステイン', 'ING_CARBOCISTEINE', 500, 'mg', '錠', '内服', 'R05CB03'],
  ['アンブロキソール塩酸塩錠15mg', 'アンブロキソール', 'ING_AMBROXOL', 15, 'mg', '錠', '内服', 'R05CB06'],
  ['デキストロメトルファン錠15mg', 'デキストロメトルファン', 'ING_DEXTROMETHORPHAN', 15, 'mg', '錠', '内服', 'R05DA09'],
  ['モンテルカストNa錠10mg', 'モンテルカスト', 'ING_MONTELUKAST', 10, 'mg', '錠', '内服', 'R03DC03'],
  ['フェキソフェナジン塩酸塩錠60mg', 'フェキソフェナジン', 'ING_FEXOFENADINE', 60, 'mg', '錠', '内服', 'R06AX26'],
  ['ロラタジン錠10mg', 'ロラタジン', 'ING_LORATADINE', 10, 'mg', '錠', '内服', 'R06AX13'],
  ['ビラスチン錠20mg', 'ビラスチン', 'ING_BILASTINE', 20, 'mg', '錠', '内服', 'R06AX29'],
  ['サルブタモール吸入', 'サルブタモール', 'ING_SALBUTAMOL', 100, 'µg', '吸入', '吸入', 'R03AC02'],
  ['ブデソニド/ホルモテロール吸入', 'ブデソニドホルモテロール', 'ING_BUD_FORM', 1, '吸入', '吸入', '吸入', 'R03AK07'],
  ['チオトロピウム吸入', 'チオトロピウム', 'ING_TIOTROPIUM', 18, 'µg', '吸入', '吸入', 'R03BB04'],
  ['テオフィリン徐放錠100mg', 'テオフィリン', 'ING_THEOPHYLLINE', 100, 'mg', '錠', '内服', 'R03DA04'],
  // 抗凝固・抗血小板
  ['ワルファリンカリウム錠1mg', 'ワルファリン', 'ING_WARFARIN', 1, 'mg', '錠', '内服', 'B01AA03'],
  ['アスピリン腸溶錠100mg', 'アスピリン', 'ING_ASPIRIN', 100, 'mg', '錠', '内服', 'B01AC06'],
  ['クロピドグレル錠75mg', 'クロピドグレル', 'ING_CLOPIDOGREL', 75, 'mg', '錠', '内服', 'B01AC04'],
  ['エドキサバン錠30mg', 'エドキサバン', 'ING_EDOXABAN', 30, 'mg', '錠', '内服', 'B01AF03'],
  ['アピキサバン錠5mg', 'アピキサバン', 'ING_APIXABAN', 5, 'mg', '錠', '内服', 'B01AF02'],
  ['リバーロキサバン錠15mg', 'リバーロキサバン', 'ING_RIVAROXABAN', 15, 'mg', '錠', '内服', 'B01AF01'],
  ['ヘパリンNa注', 'ヘパリン', 'ING_HEPARIN', 5000, '単位', '注射', '注射', 'B01AB01'],
  // 精神・神経
  ['ブロチゾラム錠0.25mg', 'ブロチゾラム', 'ING_BROTIZOLAM', 0.25, 'mg', '錠', '内服', 'N05CD09'],
  ['エスゾピクロン錠1mg', 'エスゾピクロン', 'ING_ESZOPICLONE', 1, 'mg', '錠', '内服', 'N05CF04'],
  ['スボレキサント錠15mg', 'スボレキサント', 'ING_SUVOREXANT', 15, 'mg', '錠', '内服', 'N05CM'],
  ['ロラゼパム錠0.5mg', 'ロラゼパム', 'ING_LORAZEPAM', 0.5, 'mg', '錠', '内服', 'N05BA06'],
  ['エチゾラム錠0.5mg', 'エチゾラム', 'ING_ETIZOLAM', 0.5, 'mg', '錠', '内服', 'N05BA'],
  ['セルトラリン錠25mg', 'セルトラリン', 'ING_SERTRALINE', 25, 'mg', '錠', '内服', 'N06AB06'],
  ['エスシタロプラム錠10mg', 'エスシタロプラム', 'ING_ESCITALOPRAM', 10, 'mg', '錠', '内服', 'N06AB10'],
  ['デュロキセチンカプセル20mg', 'デュロキセチン', 'ING_DULOXETINE', 20, 'mg', 'カプセル', '内服', 'N06AX21'],
  ['ミルタザピン錠15mg', 'ミルタザピン', 'ING_MIRTAZAPINE', 15, 'mg', '錠', '内服', 'N06AX11'],
  ['クエチアピン錠25mg', 'クエチアピン', 'ING_QUETIAPINE', 25, 'mg', '錠', '内服', 'N05AH04'],
  ['リスペリドン錠1mg', 'リスペリドン', 'ING_RISPERIDONE', 1, 'mg', '錠', '内服', 'N05AX08'],
  ['アリピプラゾール錠6mg', 'アリピプラゾール', 'ING_ARIPIPRAZOLE', 6, 'mg', '錠', '内服', 'N05AX12'],
  ['バルプロ酸Na徐放錠200mg', 'バルプロサン', 'ING_VALPROATE', 200, 'mg', '錠', '内服', 'N03AG01'],
  ['レベチラセタム錠500mg', 'レベチラセタム', 'ING_LEVETIRACETAM', 500, 'mg', '錠', '内服', 'N03AX14'],
  ['ラモトリギン錠25mg', 'ラモトリギン', 'ING_LAMOTRIGINE', 25, 'mg', '錠', '内服', 'N03AX09'],
  ['プレガバリンOD錠75mg', 'プレガバリン', 'ING_PREGABALIN', 75, 'mg', '口腔内崩壊錠', '内服', 'N03AX16'],
  ['ドネペジル塩酸塩OD錠5mg', 'ドネペジル', 'ING_DONEPEZIL', 5, 'mg', '口腔内崩壊錠', '内服', 'N06DA02'],
  ['メマンチン塩酸塩錠10mg', 'メマンチン', 'ING_MEMANTINE', 10, 'mg', '錠', '内服', 'N06DX01'],
  ['レボドパ・カルビドパ配合錠', 'レボドパカルビドパ', 'ING_LDOPA_CARBI', 100, 'mg', '錠', '内服', 'N04BA02'],
  // ステロイド・内分泌・骨
  ['プレドニゾロン錠5mg', 'プレドニゾロン', 'ING_PREDNISOLONE', 5, 'mg', '錠', '内服', 'H02AB06'],
  ['ベタメタゾン錠0.5mg', 'ベタメタゾン', 'ING_BETAMETHASONE', 0.5, 'mg', '錠', '内服', 'H02AB01'],
  ['レボチロキシンNa錠50µg', 'レボチロキシン', 'ING_LEVOTHYROXINE', 50, 'µg', '錠', '内服', 'H03AA01'],
  ['チアマゾール錠5mg', 'チアマゾール', 'ING_THIAMAZOLE', 5, 'mg', '錠', '内服', 'H03BB02'],
  ['アレンドロン酸錠35mg', 'アレンドロンサン', 'ING_ALENDRONATE', 35, 'mg', '錠', '内服', 'M05BA04'],
  ['エルデカルシトールカプセル0.75µg', 'エルデカルシトール', 'ING_ELDECALCITOL', 0.75, 'µg', 'カプセル', '内服', 'A11CC'],
  ['デノスマブ皮下注', 'デノスマブ', 'ING_DENOSUMAB', 60, 'mg', '注射', '注射', 'M05BX04'],
  // 泌尿器
  ['タムスロシン塩酸塩OD錠0.2mg', 'タムスロシン', 'ING_TAMSULOSIN', 0.2, 'mg', '口腔内崩壊錠', '内服', 'G04CA02'],
  ['シロドシン錠4mg', 'シロドシン', 'ING_SILODOSIN', 4, 'mg', '錠', '内服', 'G04CA04'],
  ['デュタステリドカプセル0.5mg', 'デュタステリド', 'ING_DUTASTERIDE', 0.5, 'mg', 'カプセル', '内服', 'G04CB02'],
  ['ミラベグロン錠50mg', 'ミラベグロン', 'ING_MIRABEGRON', 50, 'mg', '錠', '内服', 'G04BD12'],
  ['ソリフェナシンコハク酸塩錠5mg', 'ソリフェナシン', 'ING_SOLIFENACIN', 5, 'mg', '錠', '内服', 'G04BD08'],
  // 鎮痛補助・整形・痛風
  ['フェブキソスタット錠10mg', 'フェブキソスタット', 'ING_FEBUXOSTAT', 10, 'mg', '錠', '内服', 'M04AA03'],
  ['アロプリノール錠100mg', 'アロプリノール', 'ING_ALLOPURINOL', 100, 'mg', '錠', '内服', 'M04AA01'],
  ['コルヒチン錠0.5mg', 'コルヒチン', 'ING_COLCHICINE', 0.5, 'mg', '錠', '内服', 'M04AC01'],
  ['エペリゾン塩酸塩錠50mg', 'エペリゾン', 'ING_EPERISONE', 50, 'mg', '錠', '内服', 'M03BX09'],
  ['メコバラミン錠500µg', 'メコバラミン', 'ING_MECOBALAMIN', 500, 'µg', '錠', '内服', 'B03BA'],
  // 外用
  ['ヘパリン類似物質クリーム', 'ヘパリンルイジ', 'ING_HEPARINOID', 1, '本', '外用', '外用', 'D'],
  ['ベタメタゾン吉草酸エステル軟膏', 'ベタメタゾンキッソウ', 'ING_BETAMETHASONE_V', 1, '本', '外用', '外用', 'D07AC01'],
  ['タクロリムス軟膏0.1%', 'タクロリムスナンコウ', 'ING_TACROLIMUS_OINT', 1, '本', '外用', '外用', 'D11AH01'],
  ['ロキソプロフェンNaテープ', 'ロキソプロフェンテープ', 'ING_LOXOPROFEN_TAPE', 1, '枚', '貼付', '外用', 'M02AA'],
  ['ジクロフェナクNaゲル', 'ジクロフェナクゲル', 'ING_DICLOFENAC_GEL', 1, '本', '外用', '外用', 'M02AA15'],
  // 点眼
  ['ラタノプロスト点眼液0.005%', 'ラタノプロスト', 'ING_LATANOPROST', 1, '本', '点眼', '点眼', 'S01EE01'],
  ['チモロールマレイン酸塩点眼液', 'チモロール', 'ING_TIMOLOL', 1, '本', '点眼', '点眼', 'S01ED01'],
  ['レボフロキサシン点眼液1.5%', 'レボフロキサシンテンガン', 'ING_LVFX_EYE', 1, '本', '点眼', '点眼', 'S01AE'],
  // 補液・電解質・ビタミン
  ['生理食塩液500mL', 'セイリショクエンエキ', 'ING_NS', 500, 'mL', '注射', '注射', 'B05XA03'],
  ['ソルデム3A輸液500mL', 'ソルデム3A', 'ING_MAINTENANCE_FLUID', 500, 'mL', '注射', '注射', 'B05BB'],
  ['カリウム製剤徐放錠', 'カリウムセイザイ', 'ING_POTASSIUM', 600, 'mg', '錠', '内服', 'A12BA'],
  ['炭酸水素ナトリウム錠500mg', 'タンサンスイソナトリウム', 'ING_NAHCO3', 500, 'mg', '錠', '内服', 'B05XA'],
  ['アルファカルシドールカプセル0.25µg', 'アルファカルシドール', 'ING_ALFACALCIDOL', 0.25, 'µg', 'カプセル', '内服', 'A11CC03'],
  ['フェロミア錠50mg', 'クエンサンダイテツ', 'ING_FERROUS', 50, 'mg', '錠', '内服', 'B03AA'],
  // 漢方（頻用）
  ['葛根湯エキス顆粒', 'カッコントウ', 'ING_KAKKONTO', 1, '包', '顆粒', '内服', 'KAMPO'],
  ['芍薬甘草湯エキス顆粒', 'シャクヤクカンゾウトウ', 'ING_SHAKUYAKU', 1, '包', '顆粒', '内服', 'KAMPO'],
  ['大建中湯エキス顆粒', 'ダイケンチュウトウ', 'ING_DAIKENCHUTO', 1, '包', '顆粒', '内服', 'KAMPO'],
  ['抑肝散エキス顆粒', 'ヨクカンサン', 'ING_YOKUKANSAN', 1, '包', '顆粒', '内服', 'KAMPO'],
];

let n = 100000;
export const COMMON_DRUGS: CommonDrug[] = RX.map(
  ([brandName, brandNameKana, ingredientCode, strengthValue, strengthUnit, dosageForm, route, atcCode]) => ({
    receiptCode: `SEED${(n++).toString()}`,
    brandName,
    brandNameKana,
    genericName: brandName,
    ingredientCode,
    ingredientName: brandName.replace(/(錠|カプセル|OD錠|顆粒|散|注|点眼液|軟膏|クリーム|ゲル|テープ|吸入|徐放錠|配合錠|腸溶錠|エキス顆粒|点滴静注用|皮下注|輸液).*$/,'') || brandName,
    strengthValue,
    strengthUnit,
    dosageForm,
    route,
    atcCode,
  }),
);
