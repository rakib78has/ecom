# Release process

Written for: whoever is cutting a release.

## Versioning

`public/manifest.json` is the single source of truth. Chrome requires one to
four dot-separated integers, each 0–65535.

| Change | Bump |
|---|---|
| Bug fix, no user-visible behaviour change | patch (`0.2.0` → `0.2.1`) |
| New feature, backward compatible | minor (`0.2.0` → `0.3.0`) |
| New permission, or a change that breaks stored data | major |

**A new permission is always at least a minor bump**, and Chrome will disable
the extension for existing users until they re-accept it — call that out in the
changelog and the store listing.

## Cutting a release

1. Confirm `main` is green.
2. Bump `version` in `public/manifest.json`.
3. Add a `CHANGELOG.md` entry under that exact version. The release workflow
   fails if one is missing.
4. Run the manual QA checklist in [testing.md](testing.md). A failed
   high-priority case blocks the release.
5. Run `npm run verify` locally.
6. Commit, then tag:

   ```bash
   git tag snapcapture-v0.3.0
   git push origin snapcapture-v0.3.0
   ```

The tag must match the manifest version or the workflow stops. That check exists
because a mismatch either produces a package the store rejects or, worse,
publishes something labelled as a version it is not.

## What the pipeline does

`.github/workflows/snapcapture-release.yml` lives at the **repository root**,
because this repo holds several projects side by side and GitHub only reads
workflows from there. Every step is scoped to `ss/`.

1. **verify** — re-runs every quality gate, because a tag can point at a commit
   that never went through a pull request. Checks the tag/manifest match and the
   changelog entry, then formatting, lint, types, tests, build, manifest
   validation and the full E2E suite. Publishes the package as an artifact.
2. **publish** — gated on the `chrome-web-store` environment, which is where the
   manual approval lives. If the store secrets are absent it logs a warning and
   **skips publication**; the verified artifact is still attached to the run.

The run summary always states plainly whether the extension was *published* or
merely *built and verified*. Those are not the same thing, and the pipeline
never conflates them.

## Publishing to the Chrome Web Store

### One-time setup

1. Register as a Chrome Web Store developer (one-off fee) and create the item.
2. Create a Google Cloud project, enable the **Chrome Web Store API**, and
   create an OAuth client (type: Desktop).
3. Generate a refresh token for the scope
   `https://www.googleapis.com/auth/chromewebstore`.
4. Add four repository secrets:

   | Secret | Value |
   |---|---|
   | `CHROME_EXTENSION_ID` | The item id from the dashboard |
   | `CHROME_CLIENT_ID` | OAuth client id |
   | `CHROME_CLIENT_SECRET` | OAuth client secret |
   | `CHROME_REFRESH_TOKEN` | Refresh token from step 3 |

5. Create a `chrome-web-store` environment in repository settings and add
   required reviewers. That is what makes publication a deliberate act rather
   than a side effect of pushing a tag.

Never commit these. They belong in GitHub Actions secrets and nowhere else.

### Store listing

Review on every release:

- The description matches what the extension actually does.
- Screenshots reflect the current UI.
- **Permission justifications** — take them from [security.md](security.md),
  which is written so they can be used more or less verbatim.
- Privacy practices: no data is collected. Say so explicitly; the questionnaire
  asks per category, and a wrong answer there is a compliance problem.

### After publishing

Store review is not instantaneous and can reject. A green pipeline means the
package uploaded, not that it is live. Check the developer dashboard, and treat
the release as complete only once the item shows as published.

## Rollback

The Chrome Web Store has no "unpublish this version and restore the previous
one" button. Options, best first:

1. **Roll forward.** Fix, bump the patch version, release again. Almost always
   the right answer and the fastest path to users.
2. **Unpublish the item.** Removes it from the store for new installs. Existing
   users keep the broken version, so this limits the blast radius rather than
   fixing anything.
3. **Re-publish the previous build under a higher version number.** Revert the
   code, bump the version *above* the bad one — Chrome will not accept a
   decrease — and release.

Whichever you choose: add a changelog entry explaining what happened, and add a
regression test for the defect before the next release.

## Local packaging

```bash
npm run build
npm run validate:manifest
npm run package        # -> snapcapture-<version>.zip
```

Source maps are excluded from the package. They roughly triple the upload size
and publish the full original source, which is not something to do by accident.
