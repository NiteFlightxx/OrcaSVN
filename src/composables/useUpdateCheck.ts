import { readonly, ref } from 'vue'
import { open } from '@tauri-apps/plugin-shell'
import packageInfo from '../../package.json'
import { isNewerVersion } from '@/utils/version'

const RELEASES_API = 'https://api.github.com/repos/NiteFlightxx/OrcaSVN/releases?per_page=100'
export const RELEASES_PAGE = 'https://github.com/NiteFlightxx/OrcaSVN/releases'
const REQUEST_TIMEOUT_MS = 10_000

export type UpdateCheckState = 'idle' | 'checking' | 'upToDate' | 'available' | 'failed'

const state = ref<UpdateCheckState>('idle')
const latestVersion = ref<string | null>(null)
const releaseUrl = ref(RELEASES_PAGE)
let pending: Promise<void> | null = null

async function fetchLatestRelease(): Promise<void> {
  state.value = 'checking'
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const releases: unknown = await response.json()
    if (!Array.isArray(releases)) throw new Error('Unexpected release list')
    let newestTag = packageInfo.version
    let newerRelease: { tag_name: string } | null = null
    for (const release of releases) {
      if (
        !release ||
        typeof release !== 'object' ||
        release.draft ||
        release.prerelease ||
        typeof release.tag_name !== 'string'
      )
        continue
      if (isNewerVersion(release.tag_name, newestTag)) {
        newestTag = release.tag_name
        newerRelease = release
      }
    }
    if (newerRelease) {
      latestVersion.value = newestTag.replace(/^v/, '')
      releaseUrl.value = `${RELEASES_PAGE}/tag/${encodeURIComponent(newestTag)}`
      state.value = 'available'
    } else {
      latestVersion.value = null
      releaseUrl.value = RELEASES_PAGE
      state.value = 'upToDate'
    }
  } catch {
    // Offline or API errors stay silent; the settings page offers a manual retry.
    state.value = 'failed'
  } finally {
    window.clearTimeout(timer)
  }
}

export function useUpdateCheck() {
  const checkForUpdates = () => {
    pending ??= fetchLatestRelease().finally(() => {
      pending = null
    })
    return pending
  }

  const openReleasePage = () => open(releaseUrl.value)

  return {
    currentVersion: packageInfo.version,
    state: readonly(state),
    latestVersion: readonly(latestVersion),
    checkForUpdates,
    openReleasePage,
  }
}
