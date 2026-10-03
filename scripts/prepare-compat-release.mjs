import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const RELEASE_TARGET_COUNT = 3
const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/

function parseVersion(version) {
  const match = typeof version === 'string' ? VERSION_RE.exec(version) : null
  if (match === null) throw new Error(`invalid DSH version: ${version}`)
  const prerelease = match[4]?.split('.') ?? []
  const build = match[5]?.split('.') ?? []
  if (prerelease.some(value => !/^[0-9A-Za-z-]+$/.test(value)
    || (/^\d+$/.test(value) && value.length > 1 && value.startsWith('0')))
    || build.some(value => !/^[0-9A-Za-z-]+$/.test(value))) {
    throw new Error(`invalid DSH version: ${version}`)
  }
  return {
    core: match.slice(1, 4).map(BigInt),
    prerelease: prerelease.map(value => /^\d+$/.test(value) ? BigInt(value) : value),
  }
}

export function compareDshVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1
  }
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const av = a.prerelease[index]
    const bv = b.prerelease[index]
    if (av === undefined || bv === undefined) return av === bv ? 0 : av === undefined ? -1 : 1
    if (av === bv) continue
    if (typeof av === 'bigint' && typeof bv === 'bigint') return av < bv ? -1 : 1
    if (typeof av === 'bigint') return -1
    if (typeof bv === 'bigint') return 1
    return av < bv ? -1 : 1
  }
  return 0
}

export function selectLatestDshVersions(versions, count = RELEASE_TARGET_COUNT) {
  if (!Array.isArray(versions) || !Number.isInteger(count) || count < 1) {
    throw new TypeError('published DSH versions and a positive target count are required')
  }
  const valid = [...new Set(versions.filter(version => {
    if (typeof version !== 'string') return false
    try {
      parseVersion(version)
      return true
    } catch {
      return false
    }
  }))].sort((left, right) => compareDshVersions(right, left))
  if (valid.length < count) throw new Error(`the DSH registry returned fewer than ${count} valid versions`)
  return valid.slice(0, count)
}

export function planCompatibilityUpdate(state, targetVersions) {
  if (!Array.isArray(targetVersions) || targetVersions.length !== RELEASE_TARGET_COUNT) {
    throw new Error(`exactly the newest three DSH versions are required`)
  }
  const targets = selectLatestDshVersions(targetVersions)
  if (targets.length !== targetVersions.length || targets.some((version, index) => version !== targetVersions[index])) {
    throw new Error('DSH release targets must be exactly the newest three versions in descending semver order')
  }
  const currentTargets = state.compatibility.releaseTargets ?? []
  if (currentTargets.length === targets.length && currentTargets.every((version, index) => version === targets[index])) return null

  const compatibility = structuredClone(state.compatibility)
  const fixtures = compatibility.testFixtures ?? {}
  if (compatibility.supported) fixtures.historicalSupported = [...new Set([...(fixtures.historicalSupported ?? []), ...compatibility.supported])]
  if (compatibility.previews) fixtures.historicalPreviews = [...new Set([...(fixtures.historicalPreviews ?? []), ...compatibility.previews])]
  delete compatibility.supported
  delete compatibility.previews
  compatibility.testFixtures = fixtures
  compatibility.releaseTargets = targets
  compatibility.latestTested = targets[0]

  const manifest = structuredClone(state.manifest)
  const previousPluginVersion = manifest.version
  const parsedPluginVersion = parseVersion(previousPluginVersion)
  if (parsedPluginVersion.prerelease.length > 0) throw new Error(`compatibility release requires a stable plugin version: ${previousPluginVersion}`)
  manifest.version = `${parsedPluginVersion.core[0]}.${parsedPluginVersion.core[1]}.${parsedPluginVersion.core[2] + 1n}`
  const peerRange = targets.join(' || ')
  for (const name of Object.keys(manifest.peerDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-')) manifest.peerDependencies[name] = peerRange
  }
  for (const name of Object.keys(manifest.devDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-')) manifest.devDependencies[name] = targets[0]
  }

  return {
    previousPluginVersion,
    pluginVersion: manifest.version,
    dshVersions: targets,
    compatibility,
    manifest,
  }
}

function formatTargets(targets, language) {
  const versions = targets.map(version => `\`${version}\``)
  return language === 'zh'
    ? `**版本 {version} 支持 DSH 内核 ${versions.join('、')}。**`
    : `**Version {version} supports DSH cores ${versions[0]}, ${versions[1]}, and ${versions[2]}.**`
}

export function rewriteCompatibilityBlock(source, pluginVersion, targets, language) {
  if (targets.length !== RELEASE_TARGET_COUNT) throw new Error(`exactly ${RELEASE_TARGET_COUNT} DSH versions must be qualified`)
  const body = formatTargets(targets, language).replace('{version}', pluginVersion)
  const block = `<!-- dsh-compatibility -->\n${body}\n<!-- /dsh-compatibility -->`
  const marker = /<!-- dsh-compatibility -->[\s\S]*?<!-- \/dsh-compatibility -->/u
  if (marker.test(source)) return source.replace(marker, block)
  const legacy = language === 'zh'
    ? /^\*\*版本 [^\r\n]+ 支持 DSH 内核 [^\r\n]+\*\*$/mu
    : /^\*\*Version [^\r\n]+ supports DSH cores [^\r\n]+\*\*$/mu
  if (!legacy.test(source)) throw new Error(`missing generated DSH compatibility block (${language})`)
  return source.replace(legacy, block)
}

export function rewriteAgentCompatibility(source, pluginVersion, targets) {
  const targetList = targets.join(', ')
  let rewritten = source.replace(/^> Current release:.*$/mu,
    `> Current release: dsh-image-viewer@${pluginVersion}, qualified targets DSH ${targetList}.`)
  rewritten = rewritten.replace(/^For DSH .*$/mu,
    `For DSH ${targets[0]}, ${targets[1]}, and ${targets[2]}, use dsh-image-viewer@${pluginVersion} in **Plugins → Add plugin**. No other cores are claimed by this release.`)
  rewritten = rewritten.replaceAll(`dsh-image-viewer@${stateVersion(source)}`, `dsh-image-viewer@${pluginVersion}`)
  if (!rewritten.includes(`dsh-image-viewer@${pluginVersion}`) || rewritten === source) {
    throw new Error('Agent guide compatibility section is out of sync')
  }
  return rewritten
}

export function extractDeepSeekReleaseAgeSelectors(lockfile) {
  const packagesStart = lockfile.indexOf('\npackages:\n')
  const snapshotsStart = lockfile.indexOf('\nsnapshots:\n')
  if (packagesStart === -1 || snapshotsStart === -1 || snapshotsStart <= packagesStart) {
    throw new Error('pnpm lockfile does not contain packages and snapshots sections')
  }
  const packages = lockfile.slice(packagesStart, snapshotsStart)
  // Every package from the official @deepseek-ai scope at the locked version joins the cohort: upstream releases
  // its vendor packages (cordis, cosmokit, schemastery, ...) together with the dsh-* packages.
  const selectors = [...packages.matchAll(/^  '(@deepseek-ai\/[^']+@[^']+)':$/gmu)].map(match => match[1])
  if (selectors.length === 0) throw new Error('pnpm lockfile contains no @deepseek-ai package selectors')
  return [...new Set(selectors)].sort()
}

export function rewriteReleaseAgeCohort(workspace, selectors) {
  const marker = /^minimumReleaseAgeExclude:\r?\n((?:[ \t]+- [^\r\n]*\r?\n)*)/mu
  const match = marker.exec(workspace)
  if (match === null) throw new Error('missing minimumReleaseAgeExclude list')
  const preserved = match[1].split(/\r?\n/u).filter(line => line.trim().startsWith('- ')
    && !line.includes("'@deepseek-ai/"))
  const block = [...new Set([...preserved, ...selectors.map(selector => `  - '${selector}'`)])].sort()
  return workspace.replace(marker, `minimumReleaseAgeExclude:\n${block.join('\n')}\n`)
}

async function refreshReleaseAge(root) {
  const [workspace, lockfile] = await Promise.all([
    readFile(resolve(root, 'pnpm-workspace.yaml'), 'utf8'),
    readFile(resolve(root, 'pnpm-lock.yaml'), 'utf8'),
  ])
  const selectors = extractDeepSeekReleaseAgeSelectors(lockfile)
  await writeFile(resolve(root, 'pnpm-workspace.yaml'), rewriteReleaseAgeCohort(workspace, selectors))
  return { changed: true, selectors: selectors.length }
}

function stateVersion(source) {
  const match = /^> Current release: dsh-image-viewer@(\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?)\b/mu.exec(source)
  if (match === null) throw new Error('Agent guide release version is missing')
  return match[1]
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  if (process.argv.includes('--refresh-release-age')) return refreshReleaseAge(root)
  const targetIndex = process.argv.indexOf('--dsh-versions')
  const targetJson = targetIndex === -1 ? undefined : process.argv[targetIndex + 1]
  if (targetJson === undefined) throw new Error('--dsh-versions JSON array is required')
  const targets = JSON.parse(targetJson)
  const [compatibility, manifest] = await Promise.all([
    readFile(resolve(root, 'compatibility.json'), 'utf8').then(JSON.parse),
    readFile(resolve(root, 'package.json'), 'utf8').then(JSON.parse),
  ])
  const update = planCompatibilityUpdate({ compatibility, manifest }, targets)
  if (update === null) {
    process.stdout.write(`${JSON.stringify({ changed: false, dshVersions: targets })}\n`)
    return
  }

  const [chinese, english, agents] = await Promise.all(['README.md', 'README.en.md', 'AGENTS.md']
    .map(path => readFile(resolve(root, path), 'utf8')))
  const nextChinese = rewriteCompatibilityBlock(chinese, update.pluginVersion, update.dshVersions, 'zh')
    .replaceAll(`dsh-image-viewer@${update.previousPluginVersion}`, `dsh-image-viewer@${update.pluginVersion}`)
  const nextEnglish = rewriteCompatibilityBlock(english, update.pluginVersion, update.dshVersions, 'en')
    .replaceAll(`dsh-image-viewer@${update.previousPluginVersion}`, `dsh-image-viewer@${update.pluginVersion}`)
  const nextAgents = rewriteAgentCompatibility(agents, update.pluginVersion, update.dshVersions)

  await Promise.all([
    writeFile(resolve(root, 'compatibility.json'), `${JSON.stringify(update.compatibility, null, 2)}\n`),
    writeFile(resolve(root, 'package.json'), `${JSON.stringify(update.manifest, null, 2)}\n`),
    writeFile(resolve(root, 'README.md'), nextChinese),
    writeFile(resolve(root, 'README.en.md'), nextEnglish),
    writeFile(resolve(root, 'AGENTS.md'), nextAgents),
  ])
  process.stdout.write(`${JSON.stringify({ changed: true, ...update })}\n`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
