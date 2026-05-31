import type { NavGroup } from '@medixus/ui';

/** Hospital module navigation — covers the 厚労省 174-item functional scope. */
export const NAV: NavGroup[] = [
  {
    label: '外来',
    items: [
      { key: 'portal', label: 'ポータル', icon: 'portal', href: '/portal' },
      { key: 'select', label: '患者選択', icon: 'patients', href: '/patients/select' },
      { key: 'reservations', label: '予約管理', icon: 'calendar', href: '/reservations' },
      { key: 'reception', label: '受付', icon: 'reception', href: '/reception' },
      { key: 'schedule', label: '外来スケジュール', icon: 'clock', href: '/outpatient/schedule' },
      { key: 'questionnaire', label: '問診', icon: 'template', href: '/questionnaire' },
      { key: 'important-info', label: '重要情報', icon: 'pin', href: '/patients/important-info' },
      { key: 'patient-insurance', label: '保険・公費', icon: 'billing', href: '/patients/insurance' },
    ],
  },
  {
    label: '診療',
    items: [
      { key: 'diagnoses', label: '病名・転帰', icon: 'chart', href: '/diagnoses' },
      { key: 'templates', label: 'テンプレート', icon: 'template', href: '/templates' },
      { key: 'countersign', label: '代行入力承認', icon: 'check', href: '/countersign' },
      { key: 'referrals', label: '紹介状', icon: 'referral', href: '/referrals' },
      { key: 'documents', label: '文書管理', icon: 'sticky', href: '/documents' },
    ],
  },
  {
    label: 'オーダ',
    items: [
      { key: 'orders', label: 'オーダ一覧', icon: 'order', href: '/orders' },
      { key: 'rx', label: '処方', icon: 'rx', href: '/orders/rx' },
      { key: 'exam', label: '検査', icon: 'lab', href: '/orders/exam' },
      { key: 'labs', label: '検査結果', icon: 'lab', href: '/labs' },
      { key: 'injection', label: '注射・処置', icon: 'injection', href: '/orders/injection' },
    ],
  },
  {
    label: '病棟',
    items: [
      { key: 'wardmap', label: '病床マップ', icon: 'bed', href: '/ward/map' },
      { key: 'admissions', label: '入退院', icon: 'ward', href: '/ward/admissions' },
      { key: 'progress', label: '経過表', icon: 'chart', href: '/ward/progress' },
      { key: 'nursing', label: '看護記録', icon: 'teach', href: '/ward/nursing' },
      { key: 'discharge-summary', label: '退院時サマリー', icon: 'referral', href: '/discharge-summary' },
    ],
  },
  {
    label: '救急・在宅',
    items: [
      { key: 'er', label: '救急', icon: 'warning', href: '/er' },
      { key: 'homecare', label: '在宅医療', icon: 'home', href: '/homecare' },
    ],
  },
  {
    label: '管理',
    items: [
      { key: 'billing', label: '会計・レセプト', icon: 'billing', href: '/billing' },
      { key: 'safety-review', label: '医薬品安全レビュー', icon: 'warning', href: '/safety-review' },
      { key: 'analytics', label: '統計・分析', icon: 'chart', href: '/analytics' },
      { key: 'patient-merge', label: '患者統合', icon: 'switch', href: '/patients/merge' },
      { key: 'master', label: 'マスタ管理', icon: 'master', href: '/master' },
      { key: 'users', label: '利用者・権限', icon: 'users', href: '/admin/users' },
      { key: 'audit', label: '監査ログ', icon: 'audit', href: '/audit' },
      { key: 'board', label: '院内掲示板', icon: 'board', href: '/board' },
      { key: 'settings', label: 'システム設定', icon: 'settings', href: '/admin/settings' },
    ],
  },
];
