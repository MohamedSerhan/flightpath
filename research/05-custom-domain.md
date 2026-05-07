# Custom domain via is-a.dev (free, ~few hours review)

The site currently lives at `mohamedserhan.github.io/flightpath/`. is-a.dev runs a free subdomain registry for developers — submit a PR to their repo with a CNAME pointing at GitHub Pages and you get `flightpath.is-a.dev`. No money, no domain registrar, no DNS config of your own.

## Steps

1. **Fork** [`is-a-dev/register`](https://github.com/is-a-dev/register).
2. **Create** a file at `domains/flightpath.json`:

   ```json
   {
     "owner": {
       "username": "MohamedSerhan",
       "email": "xxskullmikexx@gmail.com"
     },
     "record": {
       "CNAME": "mohamedserhan.github.io"
     }
   }
   ```

3. **Open a PR** against `is-a-dev/register` with that file. Their bot will lint the JSON; maintainers usually merge within a few hours.
4. After merge, **set repo variable** `CUSTOM_DOMAIN = flightpath.is-a.dev` in this repo:
   - Settings → Secrets and variables → Actions → **Variables tab** → New repository variable
   - Name: `CUSTOM_DOMAIN`, Value: `flightpath.is-a.dev`
5. **Trigger a workflow run** (Actions → Scrape and deploy → Run workflow). The new build will:
   - Set Vite's base path to `/` instead of `/flightpath/`
   - Drop a `CNAME` file in the deploy artifact root
   - GitHub Pages picks up the CNAME and starts serving `flightpath.is-a.dev`
6. (Optional) **Settings → Pages** → confirm the custom domain shows green ✓ next to it. HTTPS auto-provisions in 5–60 min via Let's Encrypt.

## Alternates

- `flightpath.js.org` — js.org accepts JS/web open-source projects but their review queue is 1–4 weeks.
- `flightpath.eu.org` — works but slower, less popular.
- A real TLD via Cloudflare or Namecheap — ~$10/yr for `.app`, `.dev`, etc. Not free.

## Reverting

To go back to the github.io URL:

1. Delete the `CUSTOM_DOMAIN` variable from repo Settings.
2. Re-run the workflow. CNAME file won't be written; site goes back to the subpath.
3. Optional: open a PR against is-a-dev/register to delete `domains/flightpath.json`.

## Why this is in research/, not config

The is-a.dev step requires a manual PR submission against another repo, so the workflow can't fully automate it. The repo-side wiring is in place — `CUSTOM_DOMAIN` variable controls VITE_BASE and CNAME-file generation in `.github/workflows/scrape-and-deploy.yml`. Once you complete the is-a.dev PR and set the variable, the next deploy uses it.
