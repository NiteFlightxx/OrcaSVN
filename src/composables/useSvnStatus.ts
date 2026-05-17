export function getStatusClass(statusCode: string): string {
  switch (statusCode) {
    case 'added': return 'status-added'
    case 'modified': return 'status-modified'
    case 'deleted': return 'status-deleted'
    case 'unversioned': return 'status-unversioned'
    default: return ''
  }
}

export function getStatusLabelKey(statusCode: string): string {
  switch (statusCode) {
    case 'added': return 'status.added'
    case 'modified': return 'status.modified'
    case 'deleted': return 'status.deleted'
    case 'unversioned': return 'status.unversioned'
    default: return 'common.noData'
  }
}
