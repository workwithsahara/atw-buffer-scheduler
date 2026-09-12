# ATW → Buffer daily queue top-up (v2 — evergreen, multi-track)

Standalone automation for **"Around The World Manpower Services Inc"** on
Facebook. This version replaces the old dated (year/month folder) system
with an **evergreen loop**: three independent daily posts, each cycling
through its own 365-image library forever, on the same Facebook Page.

## The three tracks

| Track | Post time (Manila) | Content |
|---|---|---|
| **ORIGINAL** | 12:00 PM | General "hiring abroad" recruitment ad |
| **DH** | 8:00 AM | Domestic Helper pooling campaign |
| **SKILLED** | 8:00 PM | Skilled-roles pooling campaign |

All three post to the **same** Facebook Page/channel — just at different
times, with different images and different captions.

## How the loop works

**DH and SKILLED** hold a **flat** set of images named `Day001.png`
through `Day365.png` — no year/month subfolders. There's no saved
counter anywhere: the day number for any calendar date is computed from
a fixed `EPOCH_START` constant in the script. Today (the day this was
set up) is Day 365 for both tracks; tomorrow wraps to Day 1, and it
cycles forever, one year later landing back on Day 365 automatically.

**ORIGINAL** keeps its existing dated structure exactly as-is —
`<year>/<MonthFullName>/<monabbrev><DD>.png`, e.g.
`2026/September/sep24.png` — nothing converted, nothing renamed. Since
the filename encodes month+day but not year, the same file naturally
answers for that month/day every year going forward — Sept 24, 2027
reuses whichever year's `sep24.png` currently exists in Drive. This is
evergreen looping by construction, using the same content structure
that's already there.

Because DH/SKILLED share the same day-number-per-date formula, "Day014"
content posts across both tracks on the same calendar day, even though
their images/captions are unrelated to each other and to ORIGINAL.

This script is safe to re-run daily forever with zero maintenance, same
as the Loka/Voxvibes evergreen pipelines.

## What's different from v1

- No more year/month folders or `aug26.png`-style filenames — just flat
  `Day###.png` per track.
- Three captions instead of one — each track has its own, defined in
  `TRACKS` near the top of `schedule-atw-posts.js`.
- De-duplication against Buffer's queue is now by exact time (not just
  date), since three different posts can land on the same date at
  different hours.

## One-time setup

### 1. Reuse existing secrets
These stay exactly the same as before:
- `BUFFER_API_KEY`
- `BUFFER_ORG_ID` — `6a670ab031876dbd6a523a66`
- `BUFFER_CHANNEL_ID` — `6a6b9da04b2d03035f6dd877`
- `GOOGLE_DRIVE_API_KEY`

### 2. New secrets — folder ID per track

| Secret | Value |
|---|---|
| `ATW_ORIGINAL_FOLDER_ID` | `1ygnGJtz3eJObzoL4vOGE-ikDr0ypSMdF` (existing dated content — unchanged) |
| `ATW_DH_FOLDER_ID` | `1hcGUfEMjeBAlNvnySZpadK5eueQRGQUg` |
| `ATW_SKILLED_FOLDER_ID` | `1WqKhCUtOxuRFuOPmqxc_NHjz1fJ_2v72` |

> **Original track:** nothing to convert or rename. It keeps reading the
> existing `<year>/<MonthFullName>/<monabbrev><DD>.png` structure exactly
> as-is. Looping happens automatically because filenames encode month+day,
> not year — "sep24.png" applies to September 24th every year, forever.
> If two years both have a file for the same month/day, the most recently
> added year wins, so refreshing old content later is just adding a newer
> year folder — no deleting required.
>
> DH and SKILLED are the flat `Day001.png`..`Day365.png` libraries.

### 3. Remove old secrets (no longer used)
- `ATW_ROOT_FOLDER_ID`
- `ATW_MIN_DATE`
- `POST_TIME_LOCAL` / `POST_UTC_OFFSET` (post times are now per-track,
  hardcoded in `TRACKS` in the script — edit there if a time ever changes)

### 4. Replace the files
Swap in the new `schedule-atw-posts.js` and
`.github/workflows/schedule-atw-posts.yml` (keep the same paths as
before). Commit.

### 5. Test it
**Actions → "Top up ATW Buffer queue" → Run workflow → check dry_run →
Run.** The log will show all three tracks, how many images each loaded,
and which dueAt slots it would create.

Once happy, run it once for real (dry_run unchecked), confirm three posts
appear in Buffer's queue (one per track, at 8 AM / 12 PM / 8 PM), then
leave it — it runs daily on its own from then on.

## Notes on Buffer's scheduled-post cap

Buffer's free plan caps **scheduled** (not-yet-published) posts per
channel — commonly 10. With three posts a day now landing on one
channel, that cap limits how many days can be pre-scheduled at once
(roughly 3 days' worth across all tracks). This is expected, not a bug:
the script tops up daily as older posts publish and slots free up, so
the queue self-sustains — it just means the visible lookahead in Buffer's
queue view will look shorter than before.

## Editing a caption or post time later

Everything track-specific lives in the `TRACKS` array near the top of
`schedule-atw-posts.js` — edit the `caption` or `postTimeLocal` field for
the relevant track and commit. Takes effect on the next run, for newly
scheduled posts only (already-scheduled ones keep what they were
created with).
