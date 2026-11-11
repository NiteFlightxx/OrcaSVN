import type { FileMenuItem } from './fileMenu'
import type { SvnLogEntry } from '@/types'
export interface HistoryActionRequest {
  action: string
  path: string
  expectedUrl: string
  source: string
  entries: SvnLogEntry[]
}
export interface HistoryMenuContext {
  count: number
  busy: boolean
  scoped: boolean
  sameSource: boolean
  canReverse: boolean
  hasWorkspace: boolean
}
export function historyMenu(
  context: HistoryMenuContext,
  t: (key: string) => string
): FileMenuItem[] {
  const { count, busy, scoped, sameSource, canReverse, hasWorkspace } = context
  const reason =
    !count || !hasWorkspace ? 'unavailable' : busy ? 'busy' : count > 128 ? 'limit' : ''
  const item = (id: string, icon: string, blocked = '', separator = false): FileMenuItem => ({
    id,
    icon,
    label: t('historyMenu.' + id),
    disabled: Boolean(blocked),
    title: blocked ? t('historyMenu.' + blocked) : undefined,
    separator,
  })
  const single = reason || (count !== 1 ? 'singleOnly' : '')
  const branch = single || (scoped ? 'branchOnly' : '')
  const items: FileMenuItem[] = [
    { ...item('createBranch', 'GitBranch', branch), shortcut: 'Ctrl+Shift+B' },
    { ...item('createTag', 'Tag', branch), shortcut: 'Ctrl+Shift+T' },
    item('updateRevision', 'History', branch || (!sameSource ? 'currentOnly' : ''), true),
    item('checkoutRevision', 'FolderOpened', branch),
    item(
      'cherryPick',
      'GitBranch',
      reason || (scoped ? 'branchOnly' : sameSource ? 'otherOnly' : '')
    ),
    item(
      'reverseMerge',
      'RefreshLeft',
      reason || (scoped ? 'branchOnly' : !sameSource || !canReverse ? 'currentOnly' : '')
    ),
    item('editMessage', 'Edit', single),
    item('exportPatch', 'Download', reason, true),
    item('compare', 'Connection', count === 1 || count === 2 ? '' : 'twoOnly', true),
    item('compareBase', 'Connection', single || (!sameSource ? 'currentOnly' : '')),
    item('compareWorking', 'Connection', single || (!sameSource ? 'currentOnly' : '')),
    {
      ...item('copy', 'CopyDocument', '', true),
      children: [
        { ...item('copySummary', 'CopyDocument'), shortcut: 'Ctrl+C' },
        item('copyRevision', 'History'),
        item('copyMessage', 'Document'),
        item('copyAuthor', 'User'),
        item('copyDate', 'Calendar'),
        item('copyUrl', 'Connection'),
      ],
    },
    { ...item('copyInfo', 'CopyDocument'), shortcut: 'Ctrl+Shift+C' },
  ]
  const singleOnly = new Set([
    'createBranch',
    'createTag',
    'updateRevision',
    'checkoutRevision',
    'editMessage',
    'compareBase',
    'compareWorking',
  ])
  return count > 1
    ? items.filter((item) => !singleOnly.has(item.id) && (item.id !== 'compare' || count === 2))
    : items
}
export function historyClipboard(action: string, entries: SvnLogEntry[], source: string): string {
  return entries
    .map((entry) => {
      const revision = 'r' + entry.revision,
        subject = entry.message.split(/\r?\n/)[0]
      if (action === 'copyRevision') return revision
      if (action === 'copyMessage') return entry.message
      if (action === 'copyAuthor') return entry.author
      if (action === 'copyDate') return entry.date
      if (action === 'copyUrl') return source + '@' + entry.revision
      if (action === 'copyInfo')
        return [revision, source, entry.author, entry.date, '', entry.message].join('\n')
      return revision + ' - ' + subject
    })
    .join(action === 'copyInfo' || action === 'copyMessage' ? '\n-----\n' : '\n')
}
