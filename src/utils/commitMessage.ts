export interface CommitMessageParts {
  subject: string
  description: string
}

export function composeCommitMessage(subject: string, description: string): string {
  const title = subject.replace(/[\r\n]+/g, ' ').trim()
  if (!title) return ''
  const body = description.replace(/\r\n?/g, '\n').trim()
  return body ? `${title}\n\n${body}` : title
}

export function splitCommitMessage(message: string): CommitMessageParts {
  const normalized = message.replace(/\r\n?/g, '\n')
  const separator = normalized.indexOf('\n')
  if (separator < 0) return { subject: normalized, description: '' }
  const body = normalized.slice(separator + 1)
  return { subject: normalized.slice(0, separator), description: body.startsWith('\n') ? body.slice(1) : body }
}
