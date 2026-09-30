import { createGitignoreMatcher, type GitignorePattern } from '../utils/gitignore'

let patternKey = ''
let matcher = createGitignoreMatcher([])

self.onmessage = (event: MessageEvent<{ id: number; paths: string[]; patterns: GitignorePattern[] }>) => {
  const { id, paths, patterns } = event.data
  const key = JSON.stringify(patterns.map(pattern => [pattern.regex.source, pattern.regex.flags, pattern.negation, pattern.dirOnly]))
  if (key !== patternKey) {
    matcher = createGitignoreMatcher(patterns)
    patternKey = key
  }
  const visible = paths.map(path => !matcher(path))
  self.postMessage({ id, visible })
}
