export interface FileMenuItem {
  id: string
  label: string
  disabled?: boolean
  title?: string
  danger?: boolean
  separator?: boolean
  shortcut?: string
  children?: FileMenuItem[]
}
export function fitMenu(x: number, y: number, width: number, height: number, viewportWidth: number, viewportHeight: number) {
  return { x: Math.max(8, Math.min(x, viewportWidth - width - 8)), y: Math.max(8, Math.min(y, viewportHeight - height - 8)) }
}
