/**
 * Display form of the manifest paths the backend reports.
 *
 * `GET /chart/custom` answers with the absolute file each manifest was loaded
 * from (`/home/<user>/.metricstudio/charts/<id>.json`). Only the folder and the
 * file name mean anything to the user; the absolute prefix is noise, and it
 * leaks the local account name into screenshots and bug reports. The dialog
 * therefore prints the tilde form, which is what the rest of the app (and the
 * backend's own docs) call the folder anyway.
 */

/** Manifest folder as shown; matches the copy used everywhere else in the app. */
export const MANIFEST_FOLDER = '~/.metricstudio/charts'

/**
 * `~/.metricstudio/charts/<basename>` for any reportable path.
 *
 * A value that is already portable is returned unchanged: a bare file name has
 * no location to strip, and an empty string stays empty (nothing to show).
 * Windows separators are normalised first, so a path copied from a Windows
 * build reads the same as a POSIX one.
 */
export function displayManifestPath(file: string): string {
  const path = file.trim().replace(/\\/g, '/')
  const name = path.slice(path.lastIndexOf('/') + 1)
  // No separator at all: a bare name is already free of local detail.
  if (name === path) return path
  return name === '' ? MANIFEST_FOLDER : `${MANIFEST_FOLDER}/${name}`
}
