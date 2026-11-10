import { invoke } from '@tauri-apps/api/core'

export interface Identity { root: string; uuid: string; url: string; repositoryRoot: string; revision: number; depth: string }
export interface RepositoryEntry { name: string; url: string; kind: string }
export interface OperationPlan { id: string; kind: string; identity: Identity; source: string; sourceRevision: number; revision: number; fingerprint: string; preview: string; localChanges?: string[] }
export interface Outcome { id: string; kind: string; root: string; output: string; error: string | null; conflicts: string[]; identity: Identity | null; created: number }
export interface Conflict { path: string; kind: string; details: string; versions: { side: string; path: string; size: number; text: string | null }[] }
export interface AssetNode { path: string; status: string; directory: boolean; size: number; workingHash: string | null; baseHash: string | null }
export interface AssetStash { version: number; id: string; name: string; createdAt: string; identity: Identity; phase: string; warning: string | null; nodes: AssetNode[]; legacy?: Record<string, unknown> | null }
export interface Collision { path: string; currentHash: string | null }
export const repositoryIdentity = (path: string) => invoke<Identity>('repository_identity', { path })
export const repositoryBranch = (path: string, url: string) => invoke<RepositoryEntry>('repository_branch', { path, url })
export const repositoryList = (path: string, url: string) => invoke<RepositoryEntry[]>('repository_list', { path, url })
export const repositoryPreview = (path: string, source: string, revision?: number) => invoke<OperationPlan>('repository_preview', { path, source, revision })
export const repositoryExecute = (planId: string) => invoke<Outcome>('repository_execute', { planId })
export const repositoryUndo = (operationId: string) => invoke<Outcome>('repository_undo', { operationId })
export const repositoryConflicts = (path: string) => invoke<Conflict[]>('repository_conflicts', { path })
export const repositoryResolve = (path: string, file: string, strategy: string, expectedUrl: string) => invoke<Outcome>('repository_resolve', { path, file, strategy, expectedUrl })
export const repositoryActivities = () => invoke<Record<string, unknown>[]>('repository_activities')
export const assetStashCandidates = (path: string, files: string[]) => invoke<AssetNode[]>('asset_stash_candidates', { path, files })
export const assetStashList = (path: string) => invoke<AssetStash[]>('asset_stash_list', { path })
export const assetStashCreate = (path: string, name: string, files: string[], expectedUrl: string) => invoke<AssetStash>('asset_stash_create', { path, name, files, expectedUrl })
export const assetStashCheck = (path: string, id: string) => invoke<Collision[]>('asset_stash_check', { path, id })
export const assetStashApply = (path: string, id: string, pop: boolean, overwrite: Collision[]) => invoke<AssetStash>('asset_stash_apply', { path, id, pop, overwrite })
export const assetStashDelete = (id: string) => invoke<void>('asset_stash_delete', { id })
export const assetStashExport = (id: string, destination: string) => invoke<string>('asset_stash_export', { id, destination })
export const assetStashImport = (source: string) => invoke<AssetStash>('asset_stash_import', { source })
export const assetStashMigrate = (records: unknown[]) => invoke<string[]>('asset_stash_migrate', { records })
export const assetStashPreview = (id: string, file: string) => invoke<{ path: string; base: string | null; working: string | null; size: number }>('asset_stash_preview', { id, file })
