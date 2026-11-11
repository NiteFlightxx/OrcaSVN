export const commitSubject = (message: string) => message.split(/\r?\n/, 1)[0].trim() || '—'

export function authorInitials(author: string): string {
  const words = author
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean)
  if (!words.length) return '?'
  return (
    words.length > 1
      ? Array.from(words[0])[0] + Array.from(words[words.length - 1])[0]
      : Array.from(words[0]).slice(0, 2).join('')
  ).toLocaleUpperCase()
}

export function historySourceLabel(source: string): string {
  const label = source.replace(/\/+$/, '').split(/[\\/]/).pop() || source
  try {
    return decodeURIComponent(label)
  } catch {
    return label
  }
}

export function revisionDisplayPath(path: string, source: string, repositoryRoot: string): string {
  if (repositoryRoot && source.startsWith(repositoryRoot + '/')) {
    let prefix = source.slice(repositoryRoot.length).replace(/\/+$/, '')
    try {
      prefix = decodeURIComponent(prefix)
    } catch {
      /* retain the URL spelling */
    }
    if (path.startsWith(prefix + '/')) return path.slice(prefix.length + 1)
  }
  return path.replace(/^\/+/, '') || '/'
}
