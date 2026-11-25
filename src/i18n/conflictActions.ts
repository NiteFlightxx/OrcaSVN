export const conflictActionLocales = {
  'zh-CN': {
    autoBinaryTitle: '自动解决 Binaries 二进制冲突',
    autoBinaryResolved: '已保留当前本地文件并标记解决 {count} 项二进制冲突',
    selected: '已选择 {count} 个冲突路径',
    batchHint:
      '选择处理方式后确认范围。文件版本替换仅适用于内容冲突；树与属性冲突需确认手动处理结果。',
    confirmScope: '请核对本次处理的路径和结果，点击应用之前不会改动文件。',
    skipped: '以下 {count} 项为树或属性冲突，本次文件版本替换将跳过并保留它们。',
    progress: '已处理 {done} / {total}',
    failed: '{count} 项处理失败，可重试剩余项。',
    retry: '重试未完成项',
  },
  'zh-TW': {
    autoBinaryTitle: '自動解決 Binaries 二進位衝突',
    autoBinaryResolved: '已保留目前本機檔案並標記解決 {count} 項二進位衝突',
    selected: '已選擇 {count} 個衝突路徑',
    batchHint:
      '選擇處理方式後確認範圍。檔案版本取代僅適用於內容衝突；樹與屬性衝突需確認手動處理結果。',
    confirmScope: '請核對此次處理的路徑與結果，按下套用前不會變更檔案。',
    skipped: '以下 {count} 項為樹或屬性衝突，此次檔案取代將略過並保留它們。',
    progress: '已處理 {done} / {total}',
    failed: '{count} 項失敗，可重試剩餘項。',
    retry: '重試未完成項',
  },
  'en-US': {
    autoBinaryTitle: 'Automatically resolve Binaries binary conflicts',
    autoBinaryResolved: 'Kept current local files and marked {count} binary conflicts resolved',
    selected: '{count} conflict paths selected',
    batchHint:
      'Choose a resolution, then confirm its scope. File replacement applies to content conflicts. Tree and property conflicts require confirmation of manual handling.',
    confirmScope: 'Review the paths and result. Files remain unchanged until you apply.',
    skipped:
      'These {count} tree or property conflicts will be skipped and retained by this file replacement.',
    progress: 'Resolved {done} / {total}',
    failed: '{count} paths failed. Retry the remaining paths.',
    retry: 'Retry remaining paths',
  },
  'ja-JP': {
    autoBinaryTitle: 'Binaries のバイナリ競合を自動解決',
    autoBinaryResolved:
      '現在のローカルファイルを保持し、{count} 件のバイナリ競合を解決済みにしました',
    selected: '競合パス {count} 件を選択',
    batchHint:
      '解決方法を選んで対象を確認してください。ファイル置換は内容の競合に適用されます。ツリーと属性の競合には手動処理の確認が必要です。',
    confirmScope: '対象パスと結果を確認してください。適用するまで変更されません。',
    skipped: 'ツリーまたは属性の競合 {count} 件は今回のファイル置換では処理せず保持します。',
    progress: '処理済み {done} / {total}',
    failed: '{count} 件が失敗しました。残りを再試行できます。',
    retry: '未完了のパスを再試行',
  },
  'ko-KR': {
    autoBinaryTitle: 'Binaries 바이너리 충돌 자동 해결',
    autoBinaryResolved:
      '현재 로컬 파일을 유지하고 바이너리 충돌 {count}개를 해결됨으로 표시했습니다',
    selected: '충돌 경로 {count}개 선택됨',
    batchHint:
      '처리 방법을 선택한 후 범위를 확인하세요. 파일 교체는 내용 충돌에 적용됩니다. 트리 및 속성 충돌은 수동 처리 확인이 필요합니다.',
    confirmScope: '선택한 경로와 결과를 확인하세요. 적용 전에는 변경하지 않습니다.',
    skipped: '트리 또는 속성 충돌 {count}개는 이번 파일 교체에서 제외하고 유지합니다.',
    progress: '처리됨 {done} / {total}',
    failed: '{count}개 처리 실패. 남은 경로를 다시 시도할 수 있습니다.',
    retry: '미완료 경로 다시 시도',
  },
}
