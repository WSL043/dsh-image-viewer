import assert from 'node:assert/strict'
import { realpathSync } from 'node:fs'
import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
// macOS exposes the same OS temporary directory through /var and /private/var.
const temporaryRoots = [...new Set([path.resolve(tmpdir()), realpathSync(tmpdir())])]

export function evidenceLocation(value) {
  assert.ok(typeof value === 'string' && value.length > 0, 'evidence directory is required')
  const requested = path.resolve(value)
  for (const temporary of temporaryRoots) {
    const relative = path.relative(temporary, requested)
    if (path.dirname(temporary) !== temporary && relative && relative !== '..'
      && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) return { base: temporary, relative }
  }
  const artifact = path.relative(repositoryRoot, requested)
  if (artifact === '.artifacts' || artifact.startsWith('.artifacts' + path.sep)) return { base: repositoryRoot, relative: artifact }
  throw new Error('Evidence must be inside OS temporary storage or this repository .artifacts directory')
}

async function present(filename) {
  try { return await lstat(filename) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
}

export async function prepareEvidenceDirectory(value) {
  const selected = evidenceLocation(value)
  const base = await realpath(selected.base)
  let directory = base
  for (const part of selected.relative.split(path.sep)) {
    directory = path.resolve(directory, part)
    if (!directory.startsWith(base + path.sep)) throw new Error('Evidence directory escapes its root')
    let entry = await present(directory)
    if (!entry) {
      try { await mkdir(directory) } catch (error) { if (error.code !== 'EEXIST') throw error }
      entry = await lstat(directory)
    }
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('Evidence directory contains a link or non-directory')
  }
  const canonical = await realpath(directory)
  if (!canonical.startsWith(base + path.sep)) throw new Error('Evidence directory escapes its root')
  return canonical
}

export async function evidenceFile(directory, name) {
  assert.ok(typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name), 'evidence filename must be a simple leaf')
  const base = await prepareEvidenceDirectory(directory)
  const filename = path.resolve(base, name)
  if (!filename.startsWith(base + path.sep)) throw new Error('Evidence file escapes its root')
  const entry = await present(filename)
  if (!entry) return filename
  if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) throw new Error('Evidence file must be an unlinked regular file')
  const canonical = await realpath(filename)
  if (!canonical.startsWith(base + path.sep)) throw new Error('Evidence file escapes its root')
  return canonical
}

export async function writeEvidence(directory, name, bytes) {
  const filename = await evidenceFile(directory, name)
  try { await writeFile(filename, bytes, { flag: 'wx' }) }
  catch (error) {
    if (error.code !== 'EEXIST') throw error
    await writeFile(await evidenceFile(directory, name), bytes)
  }
}
