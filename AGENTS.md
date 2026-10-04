# Repository Rules

- Do not run `vercel deploy` or `vercel --prod` from this working copy. Production deploys must go through GitHub-connected deployments triggered by `git push`.
- At the start of work, run `git fetch origin` and check the difference from `origin/main` before editing or deploying anything.
- Treat code that has not been pushed to GitHub as incomplete, even if it appears to work locally or on a deployed preview.
- Only report work as complete after the relevant changes have been committed and pushed.
- When adding or changing code, follow `docs/code-placement-rules.md` (where logic belongs, what to update such as `docs/file-map.md`, and which tests to run before pushing).
