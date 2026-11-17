import { conflictExplanationLocales } from './conflictExplanation'
export const conflictReviewLocales = {
  'zh-CN': {
    ...conflictExplanationLocales['zh-CN'],
    loadingDetails: '正在读取所选路径的冲突详情…',
    empty: '当前没有检测到冲突。',
    unverified:
      '工作区状态报告此路径存在冲突，但尚未获取到可用详情。请刷新核对；外部工作副本的冲突需在对应工作副本中处理。确认详情前不会启用解决操作。',
    refreshFailed: '工作区状态刷新失败，显示的路径可能已过时。',
    content: '文件内容冲突',
    property: '属性冲突',
    tree: '树冲突',
    unknown: '待确认的冲突',
  },
  'zh-TW': {
    ...conflictExplanationLocales['zh-TW'],
    loadingDetails: '正在讀取所選路徑的衝突詳細資料…',
    empty: '目前未偵測到衝突。',
    unverified:
      '工作區狀態報告此路徑存在衝突，但尚未取得可用詳細資料。請重新整理核對；外部工作副本的衝突需在對應工作副本中處理。確認詳細資料前不會啟用解決操作。',
    refreshFailed: '工作區狀態重新整理失敗，顯示的路徑可能已過時。',
    content: '檔案內容衝突',
    property: '屬性衝突',
    tree: '樹衝突',
    unknown: '待確認的衝突',
  },
  'en-US': {
    ...conflictExplanationLocales['en-US'],
    loadingDetails: 'Reading conflict details for the selected path…',
    empty: 'No conflicts detected.',
    unverified:
      'Workspace status reports a conflict at this path, but details are not available. Refresh to verify. Conflicts in external working copies must be handled in their own working copy. Resolution stays disabled until details are confirmed.',
    refreshFailed: 'Workspace status refresh failed. The displayed paths may be outdated.',
    content: 'File content conflict',
    property: 'Property conflict',
    tree: 'Tree conflict',
    unknown: 'Conflict awaiting verification',
  },
  'ja-JP': {
    ...conflictExplanationLocales['ja-JP'],
    loadingDetails: '選択したパスの競合の詳細を読み込み中…',
    empty: '競合は検出されていません。',
    unverified:
      '作業コピーの状態に競合がありますが、詳細を取得できていません。更新して確認してください。外部作業コピーの競合は、その作業コピーで処理してください。詳細の確認まで解決操作は無効です。',
    refreshFailed: '作業コピーの状態を更新できませんでした。表示されたパスは古い可能性があります。',
    content: 'ファイル内容の競合',
    property: '属性の競合',
    tree: 'ツリーの競合',
    unknown: '確認待ちの競合',
  },
  'ko-KR': {
    ...conflictExplanationLocales['ko-KR'],
    loadingDetails: '선택한 경로의 충돌 세부 정보를 읽는 중…',
    empty: '감지된 충돌이 없습니다.',
    unverified:
      '작업 복사본 상태에 이 경로의 충돌이 표시되지만 세부 정보를 가져오지 못했습니다. 새로 고쳐 확인하세요. 외부 작업 복사본의 충돌은 해당 작업 복사본에서 처리해야 합니다. 세부 정보가 확인될 때까지 해결 작업은 비활성화됩니다.',
    refreshFailed:
      '작업 복사본 상태를 새로 고치지 못했습니다. 표시된 경로가 오래되었을 수 있습니다.',
    content: '파일 내용 충돌',
    property: '속성 충돌',
    tree: '트리 충돌',
    unknown: '확인 대기 중인 충돌',
  },
}
