import { watch } from 'vue'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { useSettings, type AppSettings } from '@/composables/useSettings'

const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
const forcedColors = window.matchMedia('(forced-colors: active)')
let initialized = false

function applyTheme(theme: AppSettings['theme']) {
  const isDark = theme === 'dark' || (theme === 'auto' && systemTheme.matches)
  document.documentElement.classList.toggle('theme-dark', isDark)
  document.documentElement.classList.toggle('dark', isDark)
  document.documentElement.classList.toggle('theme-light', !isDark)
  document.body.classList.toggle('theme-dark', isDark)
  document.body.classList.toggle('dark', isDark)
  document.body.classList.toggle('theme-light', !isDark)
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light'
  document.body.style.colorScheme = isDark ? 'dark' : 'light'
  if (isTauri()) syncWindowChrome(theme === 'auto' ? null : isDark)
}

function syncWindowChrome(dark: boolean | null) {
  const palette = getComputedStyle(document.documentElement)
  const caption = readRgb(palette.getPropertyValue('--source-titlebar'))
  const text = readRgb(palette.getPropertyValue('--md-sys-color-on-surface'))
  const useSystemColors = forcedColors.matches
  const colors = useSystemColors || caption === null || text === null ? null : { caption, text }
  void invoke('sync_window_chrome', { dark: useSystemColors ? null : dark, colors }).catch(error => {
    console.warn('Could not synchronize the native window theme.', error)
  })
}

function readRgb(value: string) {
  const rgb = value.trim()
  return /^#[0-9a-f]{6}$/i.test(rgb) ? Number.parseInt(rgb.slice(1), 16) : null
}

export function initializeTheme() {
  if (initialized) return
  initialized = true

  const { settings } = useSettings()
  applyTheme(settings.theme)
  watch(
    () => settings.accent,
    accent => { document.documentElement.dataset.accent = accent },
    { immediate: true, flush: 'sync' },
  )

  watch(
    () => settings.theme,
    theme => applyTheme(theme),
    { flush: 'sync' },
  )

  systemTheme.addEventListener('change', () => {
    if (settings.theme === 'auto') applyTheme('auto')
  })
  forcedColors.addEventListener('change', () => applyTheme(settings.theme))
}
