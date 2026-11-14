# Releasing

How this repository gets published and updated. Steps 1–3 were the first publication and are
done: the repository went public and `v1.0.0` was tagged on 2026-11-13. They stay here as a
record of how it is set up. "Before anything is pushed", step 4 and "Every release after the
first" apply to every release.

`main` only changes through a pull request that the owner merges; see the project profile in
`CLAUDE.md`.

## Before anything is pushed

A public commit is effectively permanent — forks and crawlers pick it up within minutes, and the
only real remedy for a leak is deleting the repository and starting again. So the checks below
are a gate, not a follow-up.

- `npm test` passes.
- No personal data in any file. Search case-insensitively for `arnison`, `graeme`, `@gmail`,
  `@users.noreply`, and the name of whatever project a change came from. Expected hits: the
  copyright line in `LICENSE` and in `dither-field.js`'s header, which travels with the engine
  into every export, and the `gnome00` handle in the repository and CDN links. Anything else is
  a blocker.
- No stray files: `git status --ignored` shows nothing unexpected, and nothing like `.DS_Store`,
  `.claude/` or editor settings is tracked.
- Commit identity is the GitHub noreply address, not a real one. This repository uses
  `85186781+gnome00@users.noreply.github.com`, set with `git config user.email` inside the
  repository before the first commit. Check with `git log --format='%an <%ae> / %cn <%ce>'`, and
  turn on both "Keep my email addresses private" and "Block command line pushes that expose my
  email" in GitHub's email settings.
- `docs/media/hero.png`, and any image added beside it, shows nothing private — including in
  its metadata.

## 1. Create the repository

On github.com, create a **public** repository named `dither-field` under the `gnome00` account.
Leave "Add a README file", "Add .gitignore" and "Choose a license" **unticked** — this repository
already has all three, and a commit created on GitHub would collide with the first push.

```sh
git remote add origin https://github.com/gnome00/dither-field.git
git push -u origin main
```

## 2. Repository settings

- **Pages:** source **GitHub Actions**, not a branch. `.github/workflows/ci.yml` runs the tests
  and only then publishes, so a broken push cannot take the live tuner down.
- **Actions → General:** workflow permissions read-only; untick the option allowing Actions to
  create and approve pull requests; require approval for workflow runs from outside collaborators.
- **Code security:** turn on secret scanning, push protection, Dependabot alerts and private
  vulnerability reporting. All are free on a public repository.
- **Rules:** a ruleset on `main` blocking force pushes and deletion and requiring the `test`
  check — that is the job named `test` in `.github/workflows/ci.yml`. A second ruleset protecting
  `v*` tags: every snippet anyone has pasted depends on a tag staying where it is.
- **General:** Issues on, Wiki off. Add the description, the Pages URL and a few topics.

## 3. Tag the first version

```sh
git tag v1.0.0
git push origin v1.0.0
```

The export's CDN snippet points at `https://cdn.jsdelivr.net/gh/gnome00/dither-field@v1.0.0/dither-field.js`.
Until that tag exists, the snippet 404s. Check the URL in a browser after pushing the tag.

## 4. Check the live site

Repeat this after every release, not only the first.

- Open the Pages URL, hard-reload, and confirm the tuner draws and the sliders work.
- In devtools, confirm no request leaves the origin.
- Paste the exported snippet into a scratch page that has ordinary unpositioned text, and confirm
  the text stays readable on top of the texture.
- Download the demo page, open it by double-clicking, and confirm it animates with no requests.

## Every release after the first

1. Update the version in both places it lives: `VERSION` in `dither-field.js` and `version` in
   `package.json`.
2. Add a dated section to `CHANGELOG.md`. On the first release, replace the `1.0.0 — unreleased`
   heading and its note with the date it was tagged.
3. `npm test`, then open a pull request. When it is merged, the workflow publishes the tuner.
4. After the merge, tag the merge commit on `main` with the new version, push the tag, and work
   through step 4 above against the live site.

The version in `dither-field.js` and the tag must match: `tuner/export.js` builds the CDN URL from
`VERSION`, so a mismatch hands visitors a dead link. `package.json`'s copy is not read by anything
at runtime, but letting it drift makes the other two harder to trust. Never move an existing tag — pasted snippets
are pinned to it, and moving it changes code already running on other people's sites.
