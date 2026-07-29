const version = import.meta.env.VITE_APP_VERSION || '0.0.0'
const commit = import.meta.env.VITE_APP_COMMIT || 'dev'

export const APP_VERSION = version
export const APP_COMMIT = commit
export const APP_RELEASE = `v${version} · ${commit}`
