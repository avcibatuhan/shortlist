# Security review before publishing

Done on 2026-10-13 on the repository as it would be pushed (whole history, all tracked files).
Repeat the checks with the commands below before every first push of new history.

## What was checked

| Check | How | Result |
|---|---|---|
| Apify token in tracked files or in any commit | the real value from `.env` searched in `git ls-files` and in `git log --all -p` | not found |
| Other secrets in history | patterns for Apify, GitHub and AWS tokens, private keys, assigned secrets over `git log --all -p` | one hit: the dummy `apify_api_SECRET` in a test |
| `.env`, database, raw Actor output ever committed | `git log --all --diff-filter=A -- .env data '*.db'`; `git check-ignore` | never committed; all ignored |
| Real scraped data in tracked files | every company name and long title from the local database searched in tracked text files | none in code, tests, fixtures or docs |
| Personal details of the owner | search for the details of the real profile in tracked files | none (see "Personal data") |
| Home directory or user name in tracked files | `git grep` | none |
| Python dependencies | `uvx pip-audit` on the exported runtime requirements | no known vulnerabilities |
| Frontend dependencies | `pnpm audit` | 1 high: `braces` 3.0.3 (no fixed version exists), reached only through the `shadcn` command-line tool; it is not in the built app (checked `frontend/dist`) |
| Backend static analysis | `uvx bandit -r backend/src` | no medium or high findings; 9 low (`assert`, and the fixed `nvidia-smi` call) |
| Dangerous patterns | `git grep` for `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `shell=True`, `pickle`, `yaml.load`, `verify=False`, CORS settings | none |
| Network exposure | code and a running instance | listens on `127.0.0.1` only; no CORS headers |
| Requests from other websites | probes with a foreign `Host`, `Origin` and `Sec-Fetch-Site` | **two problems found and fixed**, see below |

## Found and fixed

1. **DNS rebinding.** The server answered requests whose `Host` header was a foreign domain.
   A website could point its own domain at `127.0.0.1` and then read the API from the
   browser (profile, name, jobs) or start a paid run. Now every request whose `Host` is not
   `127.0.0.1` or `localhost` gets 403.
2. **Cross-site requests without a body.** `POST /api/match/reevaluate`,
   `POST /api/jobs/{id}/cover-letter` and `POST /api/settings/model/test` take no body, so a
   browser sends them from any website without asking first. That could not cost money or
   leak data, but it could keep the GPU busy. Now API requests with a foreign `Origin` or
   `Sec-Fetch-Site: cross-site` get 403.

Both are in [security.py](../backend/src/shortlist/security.py) and covered by
[test_security.py](../backend/tests/test_security.py). Starting a paid run from another site
was already impossible: the JSON body is rejected unless sent as `application/json`, which a
browser only does cross-site after a permission check that the server does not grant.

## How the app handles untrusted input

- **Job text** is scraped web content. It is stored and shown as plain text (React escapes
  it; no HTML is rendered), and it reaches the LLM inside a block marked as data.
- **LLM output** is accepted only if it is exactly the expected JSON; the cover letter is
  plain text shown in an editor.
- **File names** are built from fixed parts: raw output by run id, the PDF name from the
  company reduced to ASCII letters, digits and hyphens.
- **Static files** are served only from inside the built frontend folder (tested).
- **The Apify token** is read from `.env`; the API only says whether one is configured.

## Personal data

- The **profile** shipped in the code and the spec is a neutral example. The owner's real
  profile, name, searches and all job data live only in the local database under `data/`,
  which is ignored by git.
- The **prompt rules** do not describe the owner: personal limits (languages, permits) are
  read from the profile at run time.
- **The published history starts fresh.** Commits made before the rename contained a
  detailed personal profile and the previous project name; they are not part of the
  published repository.
- **Screenshots and the demo recording** are made from fixture data with invented companies
  and an invented name.

## Open points for the owner

- **Your e-mail address** is in every commit you make; it becomes public. GitHub offers a
  private `noreply` address.
- **No licence file.** Without one, others may read the code but not reuse it.
- **No authentication**, by design: anyone who can use this computer's browser can use the
  dashboard. Do not put it behind a reverse proxy or bind it to another address.
- The **GitHub Actions workflow** has never run; its first run happens on the first push.
