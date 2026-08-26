import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const installer = new URL('../install.ps1', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const compatibility = JSON.parse(await readFile(new URL('../compatibility.json', import.meta.url), 'utf8'))
const packageSpec = `dsh-native-image-viewer@${manifest.version}`
const dshSpec = `@deepseek-ai/dsh@${compatibility.latestTested}`
const windowsTest = process.platform === 'win32' ? test : test.skip

test('the helper never cold-installs the full DSH dependency tree or exposes a private Portable executable', async () => {
  const source = await readFile(installer, 'utf8')
  assert.doesNotMatch(source, /\bnpx\b|--prefer-offline|--no-audit|--no-fund/u)
  assert.doesNotMatch(source, /DSH_PORTABLE_ROOT|\.\\dsh\.exe/u)
  assert.match(source, /runtime[\\/]node[\\/]node\.exe[\s\S]*@deepseek-ai[\\/]dsh[\\/]lib[\\/]bin\.js[\s\S]*dsh\.exe/u)
  assert.match(source, /DSH was not found[\s\S]*Install or start DeepSeek Harness/u)
})

windowsTest('a running official DSH uses the verified pnpm route and selected profile home', async t => {
  const fixture = await mkdtemp(join(tmpdir(), 'dsh-image-viewer-installer-'))
  t.after(() => rm(fixture, { recursive: true, force: true }))
  const node = join(fixture, 'node.cmd')
  const bin = join(fixture, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const pnpmLog = join(fixture, 'pnpm-args.txt')
  const homeLog = join(fixture, 'home.txt')
  await mkdir(join(bin, '..'), { recursive: true })
  await writeFile(node, '@echo off\r\nexit /b 0\r\n')
  await writeFile(bin, '')
  await writeFile(join(fixture, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.1-rc.2' }))
  await writeFile(join(fixture, 'pnpm.cmd'), '@echo off\r\nif "%1"=="--version" (echo 11.19.0& exit /b 0)\r\n> "%DSH_INSTALLER_HOME_LOG%" echo %DSH_HOME%\r\n>> "%DSH_INSTALLER_PNPM_LOG%" echo %*\r\nexit /b 0\r\n')
  const quote = value => value.replaceAll("'", "''")
  const command = [
    `function global:Get-CimInstance { [pscustomobject]@{ ExecutablePath = '${quote(node)}'; CommandLine = '\"${quote(node)}\" \"${quote(bin)}\" web' } }`,
    `Get-Content -LiteralPath '${quote(installer.pathname.slice(1))}' -Raw -Encoding utf8 | Invoke-Expression`,
  ].join('; ')
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], {
    cwd: fixture,
    env: { ...process.env, PATH: `${fixture}${delimiter}${process.env.PATH ?? ''}`, USERPROFILE: fixture, DSH_INSTALLER_PNPM_LOG: pnpmLog, DSH_INSTALLER_HOME_LOG: homeLog },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.equal((await readFile(pnpmLog, 'utf8')).trim(), `dlx ${dshSpec} plugin --profile web add ${packageSpec}`)
  assert.equal((await readFile(homeLog, 'utf8')).trim(), join(await realpath(fixture), '.dsh'))
})

windowsTest('a young package already locked in the profile gets one scoped release-age retry', async t => {
  const fixture = await mkdtemp(join(tmpdir(), 'dsh-image-viewer-release-age-'))
  t.after(() => rm(fixture, { recursive: true, force: true }))
  const node = join(fixture, 'node.cmd')
  const bin = join(fixture, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const pnpmLog = join(fixture, 'pnpm-args.txt')
  await mkdir(join(bin, '..'), { recursive: true })
  await writeFile(node, '@echo off\r\nexit /b 0\r\n')
  await writeFile(join(fixture, 'pnpm.cmd'), [
    '@echo off',
    'if "%1"=="--version" (echo 11.19.0& exit /b 0)',
    '>> "%DSH_INSTALLER_PNPM_LOG%" echo %*',
    'echo %* | findstr /c:"--config.minimumReleaseAge=0" >nul',
    'if errorlevel 1 (',
    '  echo [ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] existing-package@1.0.0 1>&2',
    '  exit /b 1',
    ')',
    'echo retry succeeded',
    'exit /b 0',
    '',
  ].join('\r\n'))
  await writeFile(bin, '')
  await writeFile(join(fixture, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.1-rc.2' }))
  const quote = value => value.replaceAll("'", "''")
  const command = [
    `function global:Get-CimInstance { [pscustomobject]@{ ExecutablePath = '${quote(node)}'; CommandLine = '\"${quote(node)}\" \"${quote(bin)}\" web' } }`,
    `Get-Content -LiteralPath '${quote(installer.pathname.slice(1))}' -Raw -Encoding utf8 | Invoke-Expression`,
  ].join('; ')
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], {
    cwd: fixture,
    env: { ...process.env, PATH: `${fixture}${delimiter}${process.env.PATH ?? ''}`, USERPROFILE: fixture, DSH_INSTALLER_PNPM_LOG: pnpmLog },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.deepEqual((await readFile(pnpmLog, 'utf8')).trim().split(/\r?\n/u), [
    `dlx ${dshSpec} plugin --profile web add ${packageSpec}`,
    `dlx ${dshSpec} plugin --profile web add --config.minimumReleaseAge=0 ${packageSpec}`,
  ])
})
