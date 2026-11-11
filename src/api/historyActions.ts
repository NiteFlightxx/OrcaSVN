import { invoke } from '@tauri-apps/api/core'
export const historyCopy = (
  path: string,
  source: string,
  revision: number,
  destination: string,
  message: string,
  expectedUrl: string
) => invoke<string>('history_copy', { path, source, revision, destination, message, expectedUrl })
export const historyCheckout = (
  path: string,
  source: string,
  revision: number,
  destination: string,
  expectedUrl: string
) => invoke<string>('history_checkout', { path, source, revision, destination, expectedUrl })
export const historyEditMessage = (
  path: string,
  source: string,
  revision: number,
  previous: string,
  message: string,
  expectedUrl: string
) =>
  invoke<string>('history_edit_message', { path, source, revision, previous, message, expectedUrl })
export const historyExportPatches = (
  path: string,
  source: string,
  revisions: number[],
  destination: string,
  expectedUrl: string
) =>
  invoke<string[]>('history_export_patches', { path, source, revisions, destination, expectedUrl })
