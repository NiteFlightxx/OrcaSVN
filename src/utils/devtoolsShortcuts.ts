// Tauri's debug script listens on document in the bubbling phase and invokes
// its own devtools command, independently of the WebView's native shortcuts.
export function blockDevtoolsShortcut(event: KeyboardEvent) {
  const inspectionKey = ['KeyI', 'KeyJ', 'KeyC'].includes(event.code)
  const debugChord = inspectionKey && (
    (event.ctrlKey && event.shiftKey) || (event.metaKey && event.altKey)
  )
  if (event.key === 'F12' || event.code === 'F12' || debugChord) {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
}
