// Tauri's debug script listens on document in the bubbling phase and invokes
// its own devtools command, independently of the WebView's native shortcuts.
export function blockDevtoolsShortcut(event: KeyboardEvent) {
  // SourceGit's full-path copy chord is handled by the focused changes/menu
  // control. Prevent native inspection here, then let that control consume it.
  if (event.code === 'KeyC' && event.ctrlKey && event.shiftKey
    && (event.target as HTMLElement | null)?.closest?.('.tree-label, [data-path-menu]')) {
    event.preventDefault()
    return
  }
  const inspectionKey = ['KeyI', 'KeyJ', 'KeyC'].includes(event.code)
  const debugChord = inspectionKey && (
    (event.ctrlKey && event.shiftKey) || (event.metaKey && event.altKey)
  )
  if (event.key === 'F12' || event.code === 'F12' || debugChord) {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
}
