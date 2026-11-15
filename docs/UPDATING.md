# How updates reach the shop computer

1. A change is pushed to GitHub (`main` branch of `GITHUB_REPO`).
2. GitHub Actions runs lint + tests on Linux and Windows (`.github/workflows/ci.yml`); the **release-gate** check sums them up.
3. The shop computer (scripts/updater.js) checks every `UPDATE_CHECK_MINUTES`:
   - release-gate still running on GitHub → waits; failed → never installs that version (Docker publishing or the AI tool never block it)
   - downloads it into `app\<version>`, installs, builds, runs the tests again on the shop computer
   - waits until nobody saved anything for 1 minute, then switches (the database is backed up at start, migrations run once)
   - if the new version does not start within 90 s → goes back to the previous one and never tries that version again
4. الإدارة → البرنامج shows the version and the last update result. Log: `data\logs\launcher.log`.

Private repository: create a fine-grained token on GitHub (Settings → Developer settings → Fine-grained tokens) with access to
this repository only and permission **Contents: Read-only**, and put it in `.env` as `GITHUB_TOKEN`.
Turn updates off: `AUTO_UPDATE=off` in `.env`.
