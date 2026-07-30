# ATW → Buffer daily queue top-up

Standalone automation for **"Around The World Manpower Services Inc"** on
Facebook — completely unrelated to the LAYA brand/repos, kept separate on
purpose. This channel happens to live on the **same Buffer account** as
LAYA's LinkedIn + TikTok (it was the 3rd open slot on that free-tier
account), but the automation itself is fully independent.

## What's different from the LAYA repos

- **Every post uses the same fixed caption** (a recruitment ad) — only the
  image changes daily. The caption lives directly in
  `schedule-atw-posts.js` (search for `ATW_CAPTION`) — edit and commit that
  file if the ad copy ever needs to change.
- **Different filename convention.** Files are named like `aug26.png`
  (month abbreviation + day, no title/slug), inside
  `Social Media/<year>/<MonthFullName>/`.
- **One channel, not several.** This repo posts to a single Facebook Page,
  so there's a `BUFFER_CHANNEL_ID` secret (singular) instead of a
  comma-separated list.

## One-time setup

### 1. Buffer API key
This channel is on the **same Buffer account** as LAYA's LinkedIn/TikTok —
if you already have a personal API key from that account (Settings →
API), reuse it. Otherwise generate one there.

### 2. Google Drive API key
Reuse the same one from the LAYA repos if you already have it, or create
a new one via Google Cloud Console (see the LAYA repo's README for exact
steps) restricted to the Drive API.

### 3. IDs you need
- `BUFFER_ORG_ID`: `6a670ab031876dbd6a523a66` (same org as LAYA's
  LinkedIn/TikTok account)
- `BUFFER_CHANNEL_ID`: `6a6b9da04b2d03035f6dd877` (Around The World
  Manpower Services Inc — Facebook)
- `ATW_ROOT_FOLDER_ID`: `1ygnGJtz3eJObzoL4vOGE-ikDr0ypSMdF` (the
  `ATW/Social Media` folder — the one containing year folders like `2026`)

Make sure this folder (or everything under it) is shared as **"Anyone
with the link — Viewer"** — the Drive API key can only read
publicly-shared files, not private ones.

### 4. Minimum date
- `ATW_MIN_DATE`: `2026-08-01` — posting starts in August 2026, nothing
  earlier exists.

### 5. Create the GitHub repo and add secrets
1. Create a **new, separate** GitHub repository — e.g. `atw-buffer-scheduler`.
2. Upload `schedule-atw-posts.js`, `.github/workflows/schedule-atw-posts.yml`,
   and this `README.md` (keep the `.github/workflows/` path intact).
3. Go to **Settings → Secrets and variables → Actions** and add:

| Secret | Value |
|---|---|
| `BUFFER_API_KEY` | your Buffer API key |
| `BUFFER_ORG_ID` | `6a670ab031876dbd6a523a66` |
| `BUFFER_CHANNEL_ID` | `6a6b9da04b2d03035f6dd877` |
| `GOOGLE_DRIVE_API_KEY` | your Drive API key |
| `ATW_ROOT_FOLDER_ID` | `1ygnGJtz3eJObzoL4vOGE-ikDr0ypSMdF` |
| `ATW_MIN_DATE` | `2026-08-01` |

### 6. Test it
**Actions → "Top up ATW Buffer queue" → Run workflow → check dry_run →
Run.** Check the log — it should report how many days of content it
found and the channel's current slot usage.

Once you're happy, run it once for real (dry_run unchecked) to confirm a
post actually gets created, then leave it — it runs daily on its own.

## Notes
- Posting time defaults to 7:00 PM Manila — same as the LAYA automations,
  change via `POST_TIME_LOCAL` / `POST_UTC_OFFSET` if needed.
- Adding future months/years: just create the folder under
  `ATW/Social Media/<year>/<MonthFullName>/` with files named
  `<monabbrev><DD>.png` — no code changes needed, picked up automatically.
- If the recruitment caption ever changes, edit `ATW_CAPTION` in
  `schedule-atw-posts.js` and commit — takes effect on the next run,
  applies only to newly-scheduled posts (already-scheduled ones keep
  their original caption).
