import { redirect } from 'next/navigation';
// 受付の中核（受付一覧）は患者選択ハブの受付タブ。FE7 で受付登録/受付票を拡張。
export default function Page() {
  redirect('/patients/select?tab=reception');
}
