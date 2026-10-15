# Solo story review inputs

`inputs.zip` is a fixed, offline regression input bundle. `manifest.json` pins
the archive and each member with SHA-256. It restores the exact work files used
by source, mechanism, legacy-package and witness tests, plus reviewed source
images and current API/browser evidence.

Run `npm test` to restore missing files automatically, or run
`python3 tools/story/review_fixtures.py restore` before an individual test.
Existing local files are never overwritten. An empty checkout needs only these
versioned fixtures, the normal project dependencies and Python 3; no author's
private work directory is needed.

See `docs/solo-closeout-2026-10-15.md` for the accepted versions, coverage,
capture command and the distinction between historical and current evidence.

The shop progression update retains all 876 historical inputs and adds 10
newly executed witnesses/API reports. See `docs/shop-unlock-verification-2026-10-15.md`
for the current runtime fingerprint and explicit test entitlements.
