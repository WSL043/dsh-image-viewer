import assert from 'node:assert/strict'
import test from 'node:test'

import {
  compareDshVersions,
  extractDeepSeekReleaseAgeSelectors,
  planCompatibilityUpdate,
  rewriteAgentCompatibility,
  rewriteCompatibilityBlock,
  rewriteReleaseAgeCohort,
  selectLatestDshVersions,
} from '../scripts/prepare-compat-release.mjs'

const targets = ['0.2.0-rc.2', '0.2.0-rc.1', '0.1.7-rc.2']

const fixture = () => ({
  compatibility: {
    releaseTargets: ['0.1.7-alpha.1', '0.1.7-rc.2', '0.2.0-rc.1', '0.2.0-rc.2'],
    latestTested: '0.1.2-rc.1',
    supported: ['0.1.1-rc.2', '0.1.2-rc.1'],
    previews: ['0.1.2-alpha.2', '0.1.7-alpha.1', '0.2.0-rc.2'],
  },
  manifest: {
    name: 'dsh-image-viewer',
    version: '0.1.5',
    devDependencies: {
      '@deepseek-ai/dsh-client-locale': '0.1.7-rc.2',
      '@deepseek-ai/dsh-client-ui-layout': '0.1.7-rc.2',
    },
    peerDependencies: {
      '@deepseek-ai/dsh-client-locale': '0.1.7-alpha.1 || 0.1.7-rc.2 || 0.2.0-rc.1 || 0.2.0-rc.2',
      '@deepseek-ai/dsh-client-ui-layout': '0.1.7-alpha.1 || 0.1.7-rc.2 || 0.2.0-rc.1 || 0.2.0-rc.2',
      react: '^18.2.0',
    },
  },
})

test('selects the semver-newest three across alpha, rc, and final versions', () => {
  const versions = [
    '0.2.0-rc.1', '0.1.7-rc.2', '0.2.0-alpha.2', '0.2.0-rc.2',
    '0.2.0-beta.1', '0.2.0', '0.3.0-alpha.1', 'not-semver',
  ]
  assert.deepEqual(selectLatestDshVersions(versions), ['0.3.0-alpha.1', '0.2.0', '0.2.0-rc.2'])
  assert.ok(compareDshVersions('0.2.0', '0.2.0-rc.10') > 0)
  assert.ok(compareDshVersions('0.2.0-rc.10', '0.2.0-rc.9') > 0)
  assert.throws(() => selectLatestDshVersions(['0.2.0-rc.1', '0.2.0']), /fewer than 3/u)
})

test('moves history to test fixtures and generates a peer range with only the top three', () => {
  const state = fixture()
  const update = planCompatibilityUpdate(state, targets)
  assert.equal(update.pluginVersion, '0.1.6')
  assert.deepEqual(update.compatibility.releaseTargets, targets)
  assert.equal(update.compatibility.latestTested, targets[0])
  assert.equal(update.compatibility.supported, undefined)
  assert.equal(update.compatibility.previews, undefined)
  assert.deepEqual(update.compatibility.testFixtures.historicalSupported, ['0.1.1-rc.2', '0.1.2-rc.1'])
  assert.deepEqual(update.compatibility.testFixtures.historicalPreviews, ['0.1.2-alpha.2', '0.1.7-alpha.1', '0.2.0-rc.2'])
  assert.equal(update.manifest.peerDependencies['@deepseek-ai/dsh-client-locale'], targets.join(' || '))
  assert.equal(update.manifest.peerDependencies['@deepseek-ai/dsh-client-ui-layout'], targets.join(' || '))
  assert.equal(update.manifest.peerDependencies.react, '^18.2.0')
  assert.equal(update.manifest.devDependencies['@deepseek-ai/dsh-client-locale'], targets[0])
  assert.equal(update.manifest.devDependencies['@deepseek-ai/dsh-client-ui-layout'], targets[0])
  assert.equal(planCompatibilityUpdate({ ...state, compatibility: { ...state.compatibility, releaseTargets: targets } }, targets), null)
  assert.throws(() => planCompatibilityUpdate(state, [...targets].reverse()), /descending semver order/u)
  assert.throws(() => planCompatibilityUpdate(state, targets.slice(0, 2)), /newest three/u)
})

test('rewrites README and Agent installation compatibility text without historical core claims', () => {
  const zh = rewriteCompatibilityBlock('**版本 0.1.5 支持 DSH 内核 `old`。**', '0.1.6', targets, 'zh')
  const en = rewriteCompatibilityBlock('**Version 0.1.5 supports DSH cores `old`.**', '0.1.6', targets, 'en')
  const agents = rewriteAgentCompatibility('> Current release: dsh-image-viewer@0.1.5, qualified targets DSH old.\nFor DSH old use dsh-image-viewer@0.1.5.', '0.1.6', targets)
  assert.match(zh, /<!-- dsh-compatibility -->[\s\S]*0\.2\.0-rc\.2[\s\S]*0\.2\.0-rc\.1[\s\S]*0\.1\.7-rc\.2/u)
  assert.match(en, /<!-- dsh-compatibility -->[\s\S]*0\.2\.0-rc\.2[\s\S]*0\.2\.0-rc\.1[\s\S]*0\.1\.7-rc\.2/u)
  assert.match(agents, /Current release: dsh-image-viewer@0\.1\.6/u)
  assert.match(agents, /For DSH 0\.2\.0-rc\.2, 0\.2\.0-rc\.1, and 0\.1\.7-rc\.2/u)
  assert.doesNotMatch(agents, /historical package|0\.1\.7-alpha\.1/u)
})

test('the release-age cohort covers every official @deepseek-ai package released with a core', () => {
  const lockfile = "lockfileVersion: '9.0'\n\npackages:\n  '@deepseek-ai/cosmokit@1.8.6-alpha.1':\n  '@deepseek-ai/dsh-client-locale@0.2.1-alpha.1':\n  'react@18.3.1':\n\nsnapshots:\n  marker: true\n"
  assert.deepEqual(extractDeepSeekReleaseAgeSelectors(lockfile), [
    '@deepseek-ai/cosmokit@1.8.6-alpha.1',
    '@deepseek-ai/dsh-client-locale@0.2.1-alpha.1',
  ])
  const workspace = "minimumReleaseAge: 1440\n\nminimumReleaseAgeExclude:\n  - '@deepseek-ai/cordis@4.0.1'\n  - 'other@1.0.0'\n"
  const rewritten = rewriteReleaseAgeCohort(workspace, ['@deepseek-ai/cosmokit@1.8.6-alpha.1'])
  assert.match(rewritten, /- '@deepseek-ai\/cosmokit@1\.8\.6-alpha\.1'/u)
  assert.match(rewritten, /- 'other@1\.0\.0'/u)
  assert.doesNotMatch(rewritten, /cordis@4\.0\.1/u)
})
