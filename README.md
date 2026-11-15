# ahpd plugins

The plugins an ahpd admin finds and installs from a client. plugins.ahpio.com reads [plugins.json](plugins.json) every hour, adds each plugin's versions and files, and serves the result at `https://plugins.ahpio.com/v1/plugins.json`.

## Get a plugin listed

Open a pull request that adds one entry to `plugins` in [plugins.json](plugins.json), and changes no other file. A check runs on the pull request and says what to fix.

```json
{
  "id": "my-plugin",
  "name": "My plugin",
  "description": "One sentence that says what it does.",
  "source": "@me/my-plugin",
  "categories": ["tool"],
  "author": "Me",
  "license": "MIT",
  "repository": "https://github.com/me/my-plugin",
  "icons": [{ "src": "https://raw.githubusercontent.com/me/my-plugin/main/icon.svg" }]
}
```

| Field | Required | What it holds |
| --- | --- | --- |
| `id` | yes | The package name without its scope: `@me/my-plugin` is `my-plugin`. |
| `name` | yes | The display name, as `ahpd.title` in package.json. At most 60 characters. |
| `description` | yes | One sentence for the card. At most 200 characters. |
| `source` | yes | An npm name with no version, or `github:<owner>/<repo>`. |
| `since` | no | The oldest release to list, such as `1.0.0`. Older releases are left out. |
| `categories` | no | The same words as `ahpd.categories`, such as `agent`, `connector`, `channel` or `tool`. |
| `author` | no | The author's name. No email: the list is public. |
| `license` | no | An SPDX id, such as `MIT`. |
| `repository` | no | An `https:` URL to the source code. |
| `icons` | no | `{ "src", "theme" }` with an `https:` `src`, and `theme` `light` or `dark`. A version's own `ahpd.icons` replace these once plugins.ahpio.com reads it. |

Do not write `versions`. plugins.ahpio.com adds every release of the source by itself: each npm version, or each `v<X.Y.Z>` tag of a GitHub repo. A prerelease, such as `1.0.0-rc.1`, is not listed. A version deprecated on npm stays listed with npm's message, and ahpd does not install it.

## What the check refuses

- A pull request from a fork that changes a file other than `plugins.json`.
- A file that does not match [plugins.schema.json](plugins.schema.json), or an `id` or `source` listed twice.
- A source that is not an npm name or `github:<owner>/<repo>`. Other git hosts are not read.
- An npm package with no release, only prereleases.
- A GitHub repo with no `v<X.Y.Z>` tag. Push a tag such as `v1.0.0`, and run the check again.
- An `id` that is not the package name without its scope.
- An icon that does not answer 200.

## Run the check

```sh
node --test 'scripts/*.test.mjs'
node scripts/check.mjs
```

Set `GITHUB_TOKEN` to ask the GitHub API more than 60 times an hour.
