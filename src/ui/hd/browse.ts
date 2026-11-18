/**
 * The folder list the 3.0 file screens draw over one flat set of full paths.
 *
 * `CustomGames`, `CreateGameMenu` and `Replay` all browse a flat set of entries as a directory
 * tree: the rows of the current directory are the entries whose remainder holds no separator,
 * and the folders are the next path segment of everything under it. The subtlety is that the
 * test is a PREFIX test, not "the entry's own parent directory equals `folder`": a folder that
 * only holds further folders (Maps\hhkj\DotA\x.w3x with nothing directly in Maps\hhkj) has no
 * entries of its own, and an exact-parent filter therefore lists it as empty. Browsing the prefix
 * keeps every depth reachable.
 */
export function browseFolder<T>(
  entries: readonly { rel: string; item: T }[],
  folder: string,
  sep: string,
): { folders: string[]; files: T[] } {
  const prefix = folder ? `${folder}${sep}` : "";
  const folders = new Set<string>();
  const files: T[] = [];
  for (const { rel, item } of entries) {
    if (prefix && !rel.startsWith(prefix)) continue;
    const rest = rel.slice(prefix.length);
    const cut = rest.indexOf(sep);
    if (cut < 0) files.push(item);
    else folders.add(rest.slice(0, cut));
  }
  return { folders: [...folders].sort((a, b) => a.localeCompare(b)), files };
}

/** The parent of a browsed folder, and the empty root above the first level. */
export function parentFolder(folder: string, sep: string): string {
  const cut = folder.lastIndexOf(sep);
  return cut < 0 ? "" : folder.slice(0, cut);
}
