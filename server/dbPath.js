import path from 'path';

function clean(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Resolve SQLite storage and validate that Railway cannot use ephemeral disk. */
export function resolveDatabaseLocation(env = process.env, cwd = process.cwd()) {
  const railway = Boolean(clean(env.RAILWAY_ENVIRONMENT) || clean(env.RAILWAY_PROJECT_ID) || clean(env.RAILWAY_VOLUME_MOUNT_PATH));
  const volumeMount = clean(env.RAILWAY_VOLUME_MOUNT_PATH);
  const configuredPath = clean(env.DB_PATH);
  const inputPath = configuredPath || (railway && volumeMount
    ? path.join(volumeMount, 'screener.db')
    : './data/screener.db');
  const resolvedPath = path.isAbsolute(inputPath) ? path.normalize(inputPath) : path.resolve(cwd, inputPath);
  const resolvedVolumeMount = volumeMount
    ? (path.isAbsolute(volumeMount) ? path.normalize(volumeMount) : path.resolve(cwd, volumeMount))
    : null;

  let error = null;
  if (railway && !resolvedVolumeMount) {
    error = 'No Railway volume is attached. Add a volume to this service before deploying SQLite-backed production data.';
  } else if (railway && !isInside(resolvedVolumeMount, resolvedPath)) {
    error = `SQLite path "${resolvedPath}" is outside the Railway volume mounted at "${resolvedVolumeMount}". Set DB_PATH inside that mount or remove DB_PATH to use it automatically.`;
  }

  return {
    configuredPath,
    inputPath,
    resolvedPath,
    volumeMount: resolvedVolumeMount,
    railway,
    inferredFromVolume: !configuredPath && railway && Boolean(resolvedVolumeMount),
    error,
  };
}
