export function projectFirstLandingPath(pathname: string, search = '', hash = ''): string | null {
  const normalizedPath = pathname || '/';
  if (normalizedPath !== '/') return null;
  return `/projects${search}${hash}`;
}

export function applyProjectFirstLanding(
  locationLike: Pick<Location, 'pathname' | 'search' | 'hash'> = window.location,
  historyLike: Pick<History, 'replaceState'> = window.history,
): boolean {
  const destination = projectFirstLandingPath(locationLike.pathname, locationLike.search, locationLike.hash);
  if (!destination) return false;
  historyLike.replaceState({}, '', destination);
  return true;
}
