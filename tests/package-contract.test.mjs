import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('declares one optional web client plugin', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.equal(pkg.name, 'dsh-native-image-viewer')
  assert.match(pkg.version, /^\d+\.\d+\.\d+-beta\.\d+$/u)
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-layout'))
  assert.equal(pkg.peerDependenciesMeta.react.optional, true)
  assert.ok(pkg.files.includes('compatibility.json'))
})

test('uses the additive shell overlay and an optional service', async () => {
  const source = await readFile(new URL('src/client.jsx', root), 'utf8')
  assert.match(source, /reflect\.provide\('nativeImageViewer'/u)
  assert.match(source, /slots\.inject\('shell\.overlay'/u)
  assert.match(source, /document\.addEventListener\('click', onClick, true\)/u)
  assert.doesNotMatch(source, /MutationObserver/u)
})

test('ships zoom, pan, keyboard, gallery, download, and notes', async () => {
  const source = await readFile(new URL('src/client.jsx', root), 'utf8')
  for (const marker of ['onPointerMove', 'setZoomAt', "event.key === 'ArrowLeft'", 'download=', 'copyNotes', 'focusNote']) {
    assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))
  }
  assert.match(source, /import \{ CSS as VIEWER_CSS \} from '\.\/styles\.js'/u)
  assert.match(source, /CSS\.escape\(focusNote\)/u)
  assert.match(source, /aria-label=\{annotating \? t\('cancelAnnotate'\) : t\('annotate'\)\}/u)
  assert.match(source, /aria-label=\{t\('fit'\)\}/u)
  assert.match(source, /transformRef\.current\.zoom/u)
  assert.match(source, /addEventListener\('wheel', onWheel, \{ passive: false \}\)/u)
  assert.doesNotMatch(source, /onWheel=\{onWheel\}/u)
  assert.doesNotMatch(source, /\[request, service, fit, setZoomAt, transform\.zoom\]/u)
})

test('keeps the official lightbox hierarchy instead of replacing the whole page', async () => {
  const [source, styles] = await Promise.all([
    readFile(new URL('src/client.jsx', root), 'utf8'),
    readFile(new URL('src/styles.js', root), 'utf8'),
  ])
  assert.match(source, /className="niv-close-floating"/u)
  assert.match(source, /event\.target === event\.currentTarget/u)
  assert.match(styles, /backdrop-filter:blur\(13px\)/u)
  assert.match(styles, /\.niv-close-floating\{position:absolute;top:20px;right:20px/u)
  assert.match(styles, /\.niv-topbar\{position:absolute;right:50%;bottom:22px/u)
  assert.doesNotMatch(styles, /grid-template-rows:58px/u)
})

test('edits each region note beside its numbered image marker', async () => {
  const [source, styles] = await Promise.all([
    readFile(new URL('src/client.jsx', root), 'utf8'),
    readFile(new URL('src/styles.js', root), 'utf8'),
  ])
  assert.match(source, /className="niv-inline-note"/u)
  assert.match(source, /annotation\.x < 0\.38/u)
  assert.match(source, /annotation\.x > 0\.62/u)
  assert.match(source, /if \(event\.button !== 0 \|\| annotating\) return\s+event\.currentTarget\.setPointerCapture/u)
  assert.match(source, /data-y=\{annotation\.y < 0\.28/u)
  assert.match(source, /setAnnotations\(current => \[\.\.\.current, annotation\]\)\s+setAnnotating\(false\)/u)
  assert.match(source, /cancelAnnotate/u)
  assert.doesNotMatch(source, /className="niv-sidebar"/u)
  assert.match(styles, /\.niv-inline-note\{position:absolute;bottom:34px/u)
})

test('public docs do not contain private maintenance history', async () => {
  const docs = await Promise.all(['README.md', 'README.zh-CN.md'].map(file => readFile(new URL(file, root), 'utf8')))
  for (const text of docs) {
    assert.doesNotMatch(text, /acceptance|CI gate|polling|Portable task|internal maintenance/iu)
  }
})

test('release is gated by checks, an immutable draft, and npm beta publishing', async () => {
  const [ci, publish] = await Promise.all([
    readFile(new URL('.github/workflows/ci.yml', root), 'utf8'),
    readFile(new URL('.github/workflows/publish.yml', root), 'utf8'),
  ])
  assert.match(ci, /pnpm run test/u)
  assert.match(ci, /git diff --exit-code -- lib/u)
  assert.match(ci, /Official DSH end-to-end acceptance/u)
  assert.match(ci, /accept-official-release\.ps1/u)
  assert.match(publish, /needs: official-dsh-acceptance/u)
  assert.match(publish, /--draft --prerelease/u)
  assert.match(publish, /npm view "dsh-native-image-viewer@\$\{\{ steps\.version\.outputs\.version \}\}" version/u)
  assert.match(publish, /if: steps\.npm-version\.outputs\.needed == 'true'/u)
  assert.match(publish, /npm publish \.release\/dsh-native-image-viewer\.tgz --access public --tag beta/u)
  assert.match(publish, /--draft=false --prerelease/u)
  assert.match(publish, /\.release\/install\.ps1/u)
  assert.match(publish, /releases\/download\/v\$VERSION\/install\.ps1/u)
  assert.doesNotMatch(publish, /releases\/latest\/download\/install\.ps1/u)
  assert.match(publish, /gh release delete "\$TAG" --repo "\$GITHUB_REPOSITORY" -y \|\| true/u)
  assert.doesNotMatch(publish, /--cleanup-tag/u)
})

test('the Windows helper is version-pinned and delegates to the official DSH plugin command', async () => {
  const [installer, pkg, compatibility] = await Promise.all([
    readFile(new URL('install.ps1', root), 'utf8'),
    readFile(new URL('package.json', root), 'utf8').then(JSON.parse),
    readFile(new URL('compatibility.json', root), 'utf8').then(JSON.parse),
  ])
  assert.match(installer, new RegExp(`dsh-native-image-viewer@${pkg.version.replaceAll('.', '\\.')}`, 'u'))
  assert.match(installer, new RegExp(`\\$dshRelease = '${compatibility.latestTested.replaceAll('.', '\\.')}'`, 'u'))
  assert.match(installer, /plugin', '--profile', 'web', 'add'/u)
  assert.doesNotMatch(installer, /\bnpx\b|DSH_PORTABLE_ROOT|\.\\dsh\.exe/u)
})
