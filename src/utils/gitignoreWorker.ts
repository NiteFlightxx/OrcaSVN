import { toRaw } from 'vue'
import type { SvnStatus } from '../types'
import type { GitignorePattern } from './gitignore'

let worker: Worker | undefined
let nextId = 0
const pending = new Map<number, { resolve: (visible: boolean[]) => void; reject: (error: Error) => void }>()

export async function filterByGitignoreAsync(statuses: SvnStatus[], patterns: GitignorePattern[]): Promise<SvnStatus[]> {
  if (patterns.length === 0 || statuses.length === 0) return statuses
  if (!worker) {
    worker = new Worker(new URL('../workers/gitignore.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<{ id: number; visible: boolean[] }>) => {
      pending.get(event.data.id)?.resolve(event.data.visible)
      pending.delete(event.data.id)
    }
    worker.onerror = () => {
      for (const request of pending.values()) request.reject(new Error('Gitignore worker failed'))
      pending.clear()
      worker?.terminate()
      worker = undefined
    }
  }
  const id = ++nextId
  const visible = await new Promise<boolean[]>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    try {
      worker!.postMessage({ id, paths: statuses.map(status => status.path), patterns: toRaw(patterns) })
    } catch (error) {
      pending.delete(id)
      reject(error)
    }
  })
  return statuses.filter((_status, index) => visible[index])
}
