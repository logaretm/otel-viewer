# Changesets

`teley-cli` is the only published package, so it is the only thing that needs a
version. `teley` (web) and `teley-worker` are private and are deployed, not
released, so changesets ignores them.

## Adding a changeset

Run this in any PR that changes something users of the CLI would notice:

```sh
pnpm changeset
```

Pick `patch` / `minor` / `major`, write one line describing the change from the
user's point of view, and commit the generated file in `.changeset/`. That line
is what lands in `cli/CHANGELOG.md` and the GitHub release, so write it for
someone reading release notes, not for a reviewer reading the diff.

For a change that ships nothing user-visible (a refactor, a test, a comment),
record that explicitly instead:

```sh
pnpm changeset --empty
```

An empty changeset satisfies CI and is consumed on the next release without
bumping the version.

## `shared/` counts as the CLI

The CLI bundles `shared/parsers`, so a change under `shared/` ships to npm even
though the file lives outside `cli/`. Changesets cannot see that link on its
own, which is why the PR check covers both directories.

## Releasing

Merging a changeset to `main` does not release. It opens (or updates) a
`chore(cli): release` pull request holding the version bump and the CHANGELOG
entry every pending changeset adds up to. That PR sits there collecting further
merges, so a run of five PRs becomes one release rather than five.

Releasing is merging that PR. CI then publishes to npm, tags `cli-vX.Y.Z`, and
cuts a GitHub release from the new CHANGELOG section. Nothing else is manual.
