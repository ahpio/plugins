/**
 * Checks plugins.json before a listing is merged: the shape the schema
 * describes, and that plugins.ahpio.com can read every source in it.
 *
 * Plain Node, no dependency. Run as `node scripts/check.mjs [file]`; prints
 * one `<id>: <reason>` line for each refusal and exits 1 when there is one.
 * Reads GITHUB_TOKEN when the environment has it, for the GitHub API's
 * larger rate limit.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** A plugin id: lower-case words joined by single hyphens. */
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** An npm package name, scoped or not, with no version. */
export const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
/** A GitHub source: github:<owner>/<repo>. */
export const GITHUB = /^github:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;
/** A release tag the list takes: v<X.Y.Z>, no prerelease. */
export const RELEASE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;
/** A release version: X.Y.Z, no prerelease or build. */
export const RELEASE = /^(\d+)\.(\d+)\.(\d+)$/;

const TOP_KEYS = new Set(['$schema', 'version', 'plugins']);
const KEYS = new Set(['id', 'name', 'description', 'source', 'categories', 'author', 'license', 'repository', 'icons']);
const REQUIRED = ['id', 'name', 'description', 'source'];
const HTTPS = /^https:\/\/\S+$/;

/** The id a package gets: its name without the scope. */
export const unscoped = (name) => name.replace(/^@[^/]+\//, '');

/** The kind of a source: npm, github, or nothing for one the list does not take. */
export function sourceKind(source) {
  if (typeof source !== 'string') return undefined;
  if (GITHUB.test(source)) return 'github';
  if (NPM_NAME.test(source)) return 'npm';
  return undefined;
}

/**
 * The refusals of a parsed file's shape, as [id, reason] pairs. The id is
 * the entry's own, or its index when it has none.
 */
export function shapeProblems(list) {
  const out = [];
  if (list === null || typeof list !== 'object' || Array.isArray(list)) return [['plugins.json', 'is not an object']];
  for (const key of Object.keys(list)) if (!TOP_KEYS.has(key)) out.push(['plugins.json', `has an unknown key "${key}"`]);
  if (list.version !== 1) out.push(['plugins.json', '"version" is not 1']);
  if (!Array.isArray(list.plugins)) return [...out, ['plugins.json', '"plugins" is not an array']];
  const ids = new Set();
  const sources = new Set();
  list.plugins.forEach((entry, index) => {
    const name = typeof entry?.id === 'string' && entry.id ? entry.id : `plugins[${index}]`;
    const say = (reason) => out.push([name, reason]);
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return say('is not an object');
    for (const key of Object.keys(entry)) {
      if (key === 'versions') say('has "versions", which plugins.ahpio.com adds; remove it');
      else if (!KEYS.has(key)) say(`has an unknown key "${key}"`);
    }
    for (const key of REQUIRED) if (typeof entry[key] !== 'string' || entry[key].trim() === '') say(`"${key}" is missing or empty`);
    if (typeof entry.id === 'string' && !SLUG.test(entry.id)) say('"id" is not a slug, such as my-plugin');
    if (typeof entry.name === 'string' && entry.name.length > 60) say('"name" is longer than 60 characters');
    if (typeof entry.description === 'string' && entry.description.length > 200) say('"description" is longer than 200 characters');
    if (typeof entry.source === 'string' && sourceKind(entry.source) === undefined) {
      say('"source" is not an npm name or github:<owner>/<repo>; the list takes npm and github: sources only');
    }
    if (entry.categories !== undefined && (!Array.isArray(entry.categories) || !entry.categories.every((c) => typeof c === 'string' && SLUG.test(c)))) {
      say('"categories" is not a list of slugs');
    }
    for (const key of ['author', 'license']) {
      if (entry[key] !== undefined && (typeof entry[key] !== 'string' || entry[key].trim() === '')) say(`"${key}" is not a string`);
    }
    if (entry.repository !== undefined && !(typeof entry.repository === 'string' && HTTPS.test(entry.repository))) say('"repository" is not an https: URL');
    if (entry.icons !== undefined) {
      if (!Array.isArray(entry.icons)) say('"icons" is not a list');
      else entry.icons.forEach((icon, i) => {
        if (icon === null || typeof icon !== 'object' || !(typeof icon.src === 'string' && HTTPS.test(icon.src))) say(`icons[${i}].src is not an https: URL`);
        else {
          for (const key of Object.keys(icon)) if (key !== 'src' && key !== 'theme') say(`icons[${i}] has an unknown key "${key}"`);
          if (icon.theme !== undefined && icon.theme !== 'light' && icon.theme !== 'dark') say(`icons[${i}].theme is not light or dark`);
        }
      });
    }
    if (typeof entry.id === 'string') {
      if (ids.has(entry.id)) say('"id" is listed twice');
      ids.add(entry.id);
    }
    if (typeof entry.source === 'string') {
      if (sources.has(entry.source)) say('"source" is listed twice');
      sources.add(entry.source);
    }
  });
  return out;
}

/** The registry path of a package name: a scope's slash is %2f. */
const registryPath = (name) => name.replace('/', '%2f');

/**
 * The refusals of one entry's source, as reasons. Asks npm or GitHub, and
 * fetches each icon.
 *
 * @param {{ id: string, source: string, icons?: { src: string }[] }} entry
 * @param {{ fetch?: typeof fetch, token?: string }} [deps]
 */
export async function sourceProblems(entry, deps = {}) {
  const get = deps.fetch ?? fetch;
  const out = [];
  const kind = sourceKind(entry.source);
  if (kind === 'npm') {
    const answer = await get(`https://registry.npmjs.org/${registryPath(entry.source)}`, {
      headers: { accept: 'application/vnd.npm.install-v1+json' },
    });
    if (answer.status === 404) out.push(`${entry.source} is not on npm`);
    else if (!answer.ok) out.push(`npm answered ${answer.status} for ${entry.source}`);
    else {
      const packument = await answer.json();
      const releases = Object.keys(packument.versions ?? {}).filter((v) => RELEASE.test(v));
      if (releases.length === 0) out.push(`${entry.source} has no release on npm, only prereleases`);
      if (unscoped(entry.source) !== entry.id) out.push(`"id" is not ${unscoped(entry.source)}, the package name without its scope`);
    }
  }
  else if (kind === 'github') {
    const [, owner, repo] = GITHUB.exec(entry.source);
    const headers = { accept: 'application/vnd.github+json', 'user-agent': 'ahpio-plugins-check' };
    if (deps.token) headers.authorization = `Bearer ${deps.token}`;
    const tags = await get(`https://api.github.com/repos/${owner}/${repo}/tags?per_page=100`, { headers });
    if (tags.status === 404) out.push(`github.com/${owner}/${repo} is not there, or is not public`);
    else if (!tags.ok) out.push(`GitHub answered ${tags.status} for ${owner}/${repo}`);
    else {
      const releases = (await tags.json()).filter((t) => RELEASE_TAG.test(t?.name ?? ''));
      if (releases.length === 0) {
        out.push('has no version tag; push a tag such as v1.0.0, and run the check again');
      }
      else {
        const newest = releases.sort((a, b) => compare(b.name.slice(1), a.name.slice(1)))[0];
        const manifest = await get(`https://raw.githubusercontent.com/${owner}/${repo}/${newest.commit.sha}/package.json`);
        if (!manifest.ok) out.push(`${newest.name} has no package.json at the repo root`);
        else {
          const name = (await manifest.json())?.name;
          if (typeof name !== 'string') out.push(`package.json at ${newest.name} has no name`);
          else if (unscoped(name) !== entry.id) out.push(`"id" is not ${unscoped(name)}, the package name at ${newest.name} without its scope`);
        }
      }
    }
  }
  for (const icon of entry.icons ?? []) {
    const answer = await get(icon.src, { method: 'GET' }).catch(() => undefined);
    if (answer?.status !== 200) out.push(`icon ${icon.src} answered ${answer?.status ?? 'nothing'}, not 200`);
  }
  return out;
}

/** Compares two release versions, as a sort function does. */
export function compare(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/**
 * Every refusal of a file's text, as `<id>: <reason>` lines. The sources are
 * asked only when the shape holds.
 */
export async function check(text, deps = {}) {
  let list;
  try { list = JSON.parse(text); }
  catch (error) { return [`plugins.json: is not JSON: ${error.message}`]; }
  const shape = shapeProblems(list);
  if (shape.length > 0) return shape.map(([id, reason]) => `${id}: ${reason}`);
  const lines = [];
  for (const entry of list.plugins) {
    for (const reason of await sourceProblems(entry, deps)) lines.push(`${entry.id}: ${reason}`);
  }
  return lines;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] ?? new URL('../plugins.json', import.meta.url);
  const lines = await check(readFileSync(file, 'utf8'), { token: process.env.GITHUB_TOKEN });
  for (const line of lines) console.log(line);
  process.exitCode = lines.length > 0 ? 1 : 0;
}
