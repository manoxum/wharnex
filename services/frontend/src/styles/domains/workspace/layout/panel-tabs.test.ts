import { expect, it } from 'vitest'
import { css } from '../../../cascade/styleRules'

it('removes fixed per-panel density thresholds in favor of actual shared strip measurement', () => {
  expect(css).not.toContain('.semantic-tab-label')
  expect(css).not.toContain('@container semantic-panel (max-width: 520px)')
  expect(css).not.toContain('@container semantic-panel (max-width: 340px)')
})
