export function fileIconName(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase()
  if (['uasset', 'umap', 'dll', 'exe', 'pak', 'bin'].includes(extension || '')) return 'FileAsset'
  if (['png', 'jpg', 'jpeg', 'svg', 'webp', 'bmp', 'ico', 'tga'].includes(extension || ''))
    return 'FileImage'
  if (
    [
      'cpp',
      'h',
      'hpp',
      'c',
      'cs',
      'ts',
      'tsx',
      'js',
      'vue',
      'rs',
      'py',
      'json',
      'ini',
      'toml',
      'yaml',
      'yml',
      'xml',
      'usf',
      'ush',
    ].includes(extension || '')
  )
    return 'FileCode'
  return 'Document'
}
