import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
const root = new URL('../', import.meta.url)

test('official DSH acceptance allows only the reviewed pnpm build dependencies', async () => {
  const script = await readFile(new URL('.github/scripts/accept-official-release.ps1', root), 'utf8')
  for (const dependency of ['fs-ext', '@deepseek-ai/dsh-subprocess-local', '@google/genai', 'koffi', 'node-pty', 'protobufjs']) {
    assert.equal(script.includes(`--allow-build=${dependency}`), true, dependency)
  }
  assert.equal(script.includes('dangerously-allow-all-builds'), false)
})

test('declares one optional web client plugin', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  const compatibility = JSON.parse(await readFile(new URL('compatibility.json', root), 'utf8'))
  assert.equal(pkg.name, 'dsh-image-viewer')
  assert.match(pkg.version, /^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/u)
  assert.equal(pkg.version, '0.1.3-beta.1')
  assert.equal(pkg.publishConfig.tag, 'next')
  assert.equal(compatibility.latestTested, '0.1.2-rc.1')
  assert.ok(compatibility.supported.includes('0.1.2-rc.1'))
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-layout'))
  assert.equal(pkg.peerDependenciesMeta.react.optional, true)
  assert.ok(pkg.files.includes('compatibility.json'))
  const range = [...compatibility.supported, ...compatibility.previews].join(' || ')
  assert.deepEqual(compatibility.previews, ['0.1.2-alpha.2', '0.1.2-alpha.3', '0.1.3-alpha.2', '0.1.5-alpha.1', '0.1.6-alpha.1', '0.1.6-alpha.2', '0.1.7-alpha.1', '0.1.7-alpha.2'])
  assert.deepEqual(compatibility.releaseTargets, ['0.1.7-alpha.2'])
  for (const [name, version] of Object.entries(pkg.peerDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(version, range, name)
  }
  const acceptance = await readFile(new URL('.github/scripts/accept-official-release.ps1', root), 'utf8')
  assert.match(acceptance, /\[string\] \$DshVersion = '0\.1\.2-rc\.1'/u)
})
test('uses the additive shell overlay and an optional service', async () => {
  const source = await readFile(new URL('src/client.jsx', root), 'utf8')
  assert.match(source, /reflect\.provide\('nativeImageViewer'/u)
  assert.match(source, /slots\.inject\('shell\.overlay'/u)
  assert.match(source, /document\.addEventListener\('click', onClick, true\)/u)
  assert.doesNotMatch(source, /MutationObserver/u)
})
test('ships zoom, pan, keyboard, gallery, download, and notes', async () => {
  const source = await readFile(new URL('src/client.jsx', root), 'utf8') + await readFile(new URL('src/image-transform.js', root), 'utf8')
  for (const marker of ['onPointerMove', 'setZoomAt', "event.key === 'ArrowLeft'", 'download=', 'copyNotes', 'focusNote']) {
    assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))
  }
  assert.match(source, /import \{ CSS as VIEWER_CSS \} from '\.\/styles\.js'/u)
  assert.match(source, /CSS\.escape\(focusNote\)/u)
  assert.match(source, /aria-label=\{annotating \? t\('cancelAnnotate'\) : t\('annotate'\)\}/u)
  assert.match(source, /aria-label=\{t\('fit'\)\}/u)
  assert.match(source, /transformRef\.current\.zoom/u)
  assert.match(source, /addEventListener\('wheel', wheel, \{ passive: false \}\)/u)
  assert.doesNotMatch(source, /onWheel=\{onWheel\}/u)
  assert.doesNotMatch(source, /\[request, service, fit, setZoomAt, transform\.zoom\]/u)
  assert.match(source, /item\.actions\.map/u)
  assert.match(source, /action\.onInvoke\(\{ annotations, item, src: item\.src \}\)/u)
  assert.match(source, /action\.closeOnSuccess/u)
  assert.doesNotMatch(source, /request\.editor|className="niv-editor"/u)
  assert.doesNotMatch(source, /setEditorError|setPrompt|setBusy/u)
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
  assert.doesNotMatch(styles, /\.niv-editor/u)
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
  const transform = await readFile(new URL('src/image-transform.js', root), 'utf8')
  assert.match(source, /!annotating && imageState === 'ready' \? pointerHandlers/u)
  assert.match(transform, /closest\('button,a,input,textarea,select'\)[\s\S]*?setPointerCapture/u)
  assert.match(source, /data-y=\{annotation\.y < 0\.28/u)
  assert.match(source, /setAnnotations\(current => \[\.\.\.current, annotation\]\)\s+setAnnotating\(false\)/u)
  assert.match(source, /event\.key === 'Enter' && !event\.shiftKey/u)
  assert.match(source, /stopImmediatePropagation/u)
  assert.match(source, /closest\('\.niv-inline-note'\)/u)
  assert.match(source, /service\.setAnnotations\(item\.id, next\)/u)
  assert.match(source, /annotationsByImageRef\.current = snapshot\s+service\.setAnnotations\(item\.id, next\)\s+setAnnotationsByImage\(snapshot\)/u)
  assert.doesNotMatch(source, /setAnnotationsByImage\(\{\}\)/u)
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

test('issue intake defaults to concise English forms without title prefixes', async () => {
  const forms = await Promise.all(['bug-report.yml', 'feature-request.yml'].map(file => readFile(new URL(`.github/ISSUE_TEMPLATE/${file}`, root), 'utf8')))
  assert.match(forms[0], /^name: Bug report$/mu)
  assert.match(forms[1], /^name: Feature request$/mu)
  for (const form of forms) assert.doesNotMatch(form, /^title:/mu)
  assert.match(forms[0], /Plugin version[\s\S]*DSH version/u)
})

test('release is gated by checks, an immutable draft, and version-appropriate channels', async () => {
  const [ci, publish] = await Promise.all([
    readFile(new URL('.github/workflows/ci.yml', root), 'utf8'),
    readFile(new URL('.github/workflows/publish.yml', root), 'utf8'),
  ])
  assert.match(ci, /pnpm run test/u)
  assert.match(ci, /git diff --exit-code -- lib/u)
  assert.match(ci, /Official DSH end-to-end acceptance/u)
  assert.match(ci, /accept-official-release\.ps1/u)
  assert.match(publish, /needs: official-dsh-acceptance/u)
  assert.match(publish, /c\.releaseTargets \?\? \[c\.latestTested,c\.previews\.at\(-1\)\]/u)
  assert.match(publish, /--draft --prerelease/u)
  assert.match(publish, /--draft --latest/u)
  assert.match(publish, /--title "\$TAG"/u)
  assert.match(publish, /npm view "dsh-image-viewer@\$version" dist\.tarball/u)
  assert.match(publish, /diff -qr --strip-trailing-cr --exclude='\*\.map'/u)
  assert.match(publish, /cp "\$RUNNER_TEMP\/npm\.tgz" \.release\/dsh-image-viewer\.tgz/u)
  assert.match(publish, /npm publish \.release\/dsh-image-viewer\.tgz --access public --tag "\$npm_tag"/u)
  assert.match(publish, /fetch-depth: 0/u)
  assert.match(publish, /git describe --tags --abbrev=0 --match 'v\[0-9\]\*' HEAD\^/u)
  assert.match(publish, /No release-bearing plugin change since \$previous_tag/u)
  assert.match(publish, /jq '\{name,main,exports,files,dsh,engines,dependencies,optionalDependencies,peerDependencies,peerDependenciesMeta\}'/u)
  assert.match(publish, /release_files=.*package\.json/u)
  assert.match(publish, /latest_before=.*npm view dsh-image-viewer dist-tags\.latest/u)
  assert.match(publish, /tag_after=.*npm view dsh-image-viewer "dist-tags\.\$npm_tag"/u)
  assert.match(publish, /expected_latest="\$version"[\s\S]*?expected_latest="\$latest_before"/u)
  assert.match(publish, /if \[\[ "\$tag_after" != "\$version" \|\| "\$latest_after" != "\$expected_latest" \]\]; then[\s\S]*?exit 1/u)
  assert.ok(publish.indexOf('Publish or reconcile with npm') < publish.indexOf('Create verified draft release'))
  assert.match(publish, /--draft=false --prerelease/u)
  assert.match(publish, /--draft=false --latest/u)
  assert.match(publish, /dsh plugin --profile web add dsh-image-viewer/u)
  assert.doesNotMatch(publish, /\birm\b|install\.ps1/iu)
  assert.match(publish, /contributor_prs:[\s\S]*merged contributor PR numbers/u)
  assert.match(publish, /gh pr view "\$pr_number"[\s\S]*author,mergedAt,number,url/u)
  assert.doesNotMatch(publish, /reported_issues|REPORTED_ISSUES|Issue reporters/u)
  assert.match(publish, /real line breaks, not literal/u)
  assert.match(publish, /## What's new[\s\S]*## Install or update[\s\S]*## 中文[\s\S]*## 更新内容[\s\S]*## 安装或更新/u)
  assert.match(publish, /gh release delete "\$TAG" --repo "\$GITHUB_REPOSITORY" -y \|\| true/u)
  assert.doesNotMatch(publish, /--cleanup-tag/u)
})
