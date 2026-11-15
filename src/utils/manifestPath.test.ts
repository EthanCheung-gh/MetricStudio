import { describe, expect, it } from 'vitest'
import { MANIFEST_FOLDER, displayManifestPath } from '@/utils/manifestPath'

describe('displayManifestPath', () => {
  it('replaces an absolute prefix with the tilde form', () => {
    expect(displayManifestPath('/home/ada/.metricstudio/charts/facet-grid.json')).toBe(
      `${MANIFEST_FOLDER}/facet-grid.json`,
    )
    // Same for a macOS home and for a path nested deeper than the folder.
    expect(displayManifestPath('/Users/ada/.metricstudio/charts/facet-grid.json')).toBe(
      `${MANIFEST_FOLDER}/facet-grid.json`,
    )
  })

  it('keeps a bare file name unchanged', () => {
    expect(displayManifestPath('facet-grid.json')).toBe('facet-grid.json')
    // Nothing to show for nothing.
    expect(displayManifestPath('')).toBe('')
  })

  it('normalises Windows separators before taking the basename', () => {
    expect(
      displayManifestPath('C:\\Users\\ada\\.metricstudio\\charts\\facet-grid.json'),
    ).toBe(`${MANIFEST_FOLDER}/facet-grid.json`)
  })
})
