import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check, shapeProblems, sourceProblems } from './check.mjs';

const ENTRY = {
  id: 'agent-acp',
  name: 'Agent ACP',
  description: 'Connects any ACP-compatible agent.',
  source: '@ahpd/agent-acp',
  icons: [{ src: 'https://example.com/icon.svg', theme: 'light' }],
};

/** A fetch that answers from a map of URL to [status, body]. */
function stub(answers) {
  return async (url) => {
    const found = answers[url];
    if (!found) return new Response('not stubbed', { status: 599 });
    const [status, body] = found;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
}

const NPM_OK = {
  'https://registry.npmjs.org/@ahpd%2fagent-acp': [200, { name: '@ahpd/agent-acp', versions: { '0.14.0': {}, '0.15.0-rc.1': {} } }],
  'https://example.com/icon.svg': [200, '<svg/>'],
};

test('an entry that holds passes', async () => {
  const lines = await check(JSON.stringify({ version: 1, plugins: [ENTRY] }), { fetch: stub(NPM_OK) });
  assert.deepEqual(lines, []);
});

test('a file that is not JSON is refused', async () => {
  const [line] = await check('{', { fetch: stub({}) });
  assert.match(line, /^plugins\.json: is not JSON/);
});

test('a wrong format version and an unknown key are refused', () => {
  const problems = shapeProblems({ version: 2, plugins: [], extra: true });
  assert.deepEqual(problems.map(([, r]) => r), ['has an unknown key "extra"', '"version" is not 1']);
});

test('a missing field, a bad slug and hand-written versions are refused', () => {
  const problems = shapeProblems({ version: 1, plugins: [{ id: 'Bad_Id', name: 'x', source: 'x', versions: [] }] });
  const reasons = problems.map(([, r]) => r);
  assert.ok(reasons.includes('has "versions", which plugins.ahpio.com adds; remove it'));
  assert.ok(reasons.includes('"description" is missing or empty'));
  assert.ok(reasons.includes('"id" is not a slug, such as my-plugin'));
});

test('a repeated id or source is refused', () => {
  const problems = shapeProblems({ version: 1, plugins: [ENTRY, ENTRY] });
  assert.deepEqual(problems.map(([, r]) => r), ['"id" is listed twice', '"source" is listed twice']);
});

test('a git+https: source is refused with the sources the list takes', () => {
  const problems = shapeProblems({ version: 1, plugins: [{ ...ENTRY, source: 'git+https://example.com/x.git' }] });
  assert.deepEqual(problems, [['agent-acp', '"source" is not an npm name or github:<owner>/<repo>; the list takes npm and github: sources only']]);
});

test('an icon or a repository that is not https: is refused', () => {
  const problems = shapeProblems({ version: 1, plugins: [{ ...ENTRY, repository: 'http://example.com', icons: [{ src: 'http://example.com/i.svg' }] }] });
  assert.deepEqual(problems.map(([, r]) => r), ['"repository" is not an https: URL', 'icons[0].src is not an https: URL']);
});

test('an npm source with prereleases only is refused', async () => {
  const reasons = await sourceProblems(ENTRY, { fetch: stub({ ...NPM_OK, 'https://registry.npmjs.org/@ahpd%2fagent-acp': [200, { versions: { '0.15.0-rc.1': {} } }] }) });
  assert.deepEqual(reasons, ['@ahpd/agent-acp has no release on npm, only prereleases']);
});

test('an npm source that is not on npm is refused', async () => {
  const reasons = await sourceProblems(ENTRY, { fetch: stub({ ...NPM_OK, 'https://registry.npmjs.org/@ahpd%2fagent-acp': [404, {}] }) });
  assert.deepEqual(reasons, ['@ahpd/agent-acp is not on npm']);
});

test('an id that is not the package name is refused', async () => {
  const reasons = await sourceProblems({ ...ENTRY, id: 'acp' }, { fetch: stub(NPM_OK) });
  assert.deepEqual(reasons, ['"id" is not agent-acp, the package name without its scope']);
});

test('a github: source with no version tag is told to push one', async () => {
  const entry = { id: 'web', name: 'Web', description: 'A web UI.', source: 'github:ahpio/ahpw' };
  const fetch = stub({ 'https://api.github.com/repos/ahpio/ahpw/tags?per_page=100': [200, [{ name: 'v0.9.0-rc.1', commit: { sha: 'a' } }, { name: 'nightly', commit: { sha: 'b' } }]] });
  assert.deepEqual(await sourceProblems(entry, { fetch }), ['has no version tag; push a tag such as v1.0.0, and run the check again']);
});

test('a github: source reads the id from the newest tag', async () => {
  const entry = { id: 'web', name: 'Web', description: 'A web UI.', source: 'github:ahpio/ahpw' };
  const fetch = stub({
    'https://api.github.com/repos/ahpio/ahpw/tags?per_page=100': [200, [{ name: 'v0.7.1', commit: { sha: 'old' } }, { name: 'v0.8.0', commit: { sha: 'new' } }]],
    'https://raw.githubusercontent.com/ahpio/ahpw/new/package.json': [200, { name: '@ahpd/web' }],
  });
  assert.deepEqual(await sourceProblems(entry, { fetch }), []);
});

test('an icon that does not answer 200 is refused', async () => {
  const reasons = await sourceProblems(ENTRY, { fetch: stub({ ...NPM_OK, 'https://example.com/icon.svg': [404, ''] }) });
  assert.deepEqual(reasons, ['icon https://example.com/icon.svg answered 404, not 200']);
});

test('since must be a release version that leaves a release', async () => {
  assert.deepEqual(shapeProblems({ version: 1, plugins: [{ ...ENTRY, since: 'v1' }] }).map(([, r]) => r), ['"since" is not a release version, such as 1.0.0']);
  assert.deepEqual(await sourceProblems({ ...ENTRY, since: '0.14.0' }, { fetch: stub(NPM_OK) }), []);
  assert.deepEqual(await sourceProblems({ ...ENTRY, since: '2.0.0' }, { fetch: stub(NPM_OK) }), ['no release on npm is 2.0.0 or newer, so "since" leaves nothing']);
});
