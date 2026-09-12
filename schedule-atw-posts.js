#!/usr/bin/env node
/**
 * ATW → Buffer daily queue top-up (EVERGREEN, multi-track, v3)
 * -----------------------------------------------------------------------
 * Posts to "Around The World Manpower Services Inc" on Facebook — ONE
 * channel, THREE independent daily posts (tracks), each with its own
 * image library, caption, and time of day:
 *
 *   ORIGINAL  — general "we're hiring abroad" recruitment ad   — 12:00 PM
 *   DH        — Domestic Helper pooling campaign                —  8:00 AM
 *   SKILLED   — Skilled roles pooling campaign                  —  8:00 PM
 *
 * All times are Asia/Manila (+08:00).
 *
 * TWO LIBRARY FORMATS, TWO LOOP MECHANISMS
 * -----------------------------------------------------------------------
 * ORIGINAL uses the pre-existing dated structure — no reorganizing, no
 * renaming, nothing converted. Files already live at:
 *     <ATW_ORIGINAL_FOLDER_ID>/<year>/<MonthFullName>/<monabbrev><DD>.png
 * e.g. .../2026/September/sep24.png
 * Because filenames encode month+day (not year), the SAME file naturally
 * applies to that month/day every year forever — Sept 24, 2026 and Sept
 * 24, 2027 both resolve to whichever year's "sep24.png" actually exists
 * in Drive (preferring the most recently added year if more than one
 * year has that date, so refreshing old content is just adding a newer
 * year folder). This gives evergreen looping for free, with zero file
 * operations — it's just how real calendar dates already work.
 *
 * DH and SKILLED use a FLAT set of images named "Day001.png".."Day365.png"
 * (no year/month folders). The day number for any calendar date is
 * computed from a fixed EPOCH_START constant — no persisted counter, no
 * file renaming ever needed. EPOCH_START is set so TODAY = Day 365 for
 * both tracks, wrapping to Day 1 tomorrow, cycling forever.
 *
 * De-duplication against Buffer's scheduled queue is done by exact dueAt
 * timestamp (to the minute), not just by date, since three tracks post
 * at three different times on the same channel.
 *
 * SCHEDULING ORDER: day-by-day, not track-by-track. For each future date
 * (today, today+1, today+2...), all three tracks are attempted before
 * moving to the next date. This matters because the channel's scheduled-
 * post cap is shared across all three tracks — filling one track's full
 * lookahead before touching the others would starve them of slots
 * entirely. Interleaving by date means the limited slots get spread
 * evenly across DH/Original/Skilled instead of one track eating them all.
 *
 * Required environment variables (repo/CI secrets):
 *   BUFFER_API_KEY          Personal API key (same Buffer account as LAYA)
 *   BUFFER_ORG_ID           That Buffer account's organization ID
 *   BUFFER_CHANNEL_ID       The Facebook channel ID for the ATW Page
 *                           (same channel for all three tracks)
 *   GOOGLE_DRIVE_API_KEY    API key with Drive API enabled (read-only)
 *   ATW_ORIGINAL_FOLDER_ID  Drive folder ID — dated year/month structure
 *                           (existing content, e.g. 1ygnGJ...SMdF)
 *   ATW_DH_FOLDER_ID        Drive folder ID — flat Day001.png..Day365.png
 *   ATW_SKILLED_FOLDER_ID   Drive folder ID — flat Day001.png..Day365.png
 * Optional:
 *   DRY_RUN                 "true" to log without creating posts
 *   LOOKAHEAD_DAYS          Default 14 — how many future days to consider
 *                           scheduling per track (actual count created is
 *                           still capped by Buffer's live scheduled-post
 *                           limit per channel)
 *
 * Requires Node.js 18+ (uses global fetch).
 */

const BUFFER_API_KEY = requireEnv("BUFFER_API_KEY");
const ORG_ID = requireEnv("BUFFER_ORG_ID");
const CHANNEL_ID = requireEnv("BUFFER_CHANNEL_ID");
const DRIVE_API_KEY = requireEnv("GOOGLE_DRIVE_API_KEY");

const DRY_RUN = process.env.DRY_RUN === "true";
const LOOKAHEAD_DAYS = parseInt(process.env.LOOKAHEAD_DAYS || "14", 10);

const BUFFER_GRAPHQL_URL = "https://api.buffer.com/graphql";
const POST_UTC_OFFSET = "+08:00"; // Asia/Manila, all three tracks

// EPOCH_START for the flat-library tracks (DH, SKILLED) only. Today = Day
// 365; tomorrow wraps to Day 1. ORIGINAL doesn't use this at all — it
// loops via real month/day matching instead (see header comment).
const EPOCH_START = "2026-09-12";

const MONTH_NUMBERS = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};
const FULL_MONTH_TO_NUM = {
  january: "01", february: "02", march: "03", april: "04",
  may: "05", june: "06", july: "07", august: "08",
  september: "09", october: "10", november: "11", december: "12",
};

// ---------------------------------------------------------------------------
// Track definitions — this is the ONLY place to edit if a caption, post
// time, or folder ever changes.
// ---------------------------------------------------------------------------
const TRACKS = [
  {
    name: "ORIGINAL",
    format: "dated", // year/month folders, monDD.png filenames, loops by month+day
    folderId: requireEnv("ATW_ORIGINAL_FOLDER_ID"),
    postTimeLocal: "12:00:00", // 12 PM Manila
    caption: `Ready ka na bang mag-work abroad? Baka ito na ang opportunity na hinihintay mo!

DMW License Number: 495-LB-02102025-R

We're hiring for multiple overseas positions in different countries, and we want to know what kind of opportunity you're looking for.

📩 To fast-track your application, send us a DM with:

• Full Name
• Position or type of work na gusto mo
• Preferred country 
• Age
• Gender

Hindi sure kung anong position or country ang bagay sa'yo? No worries! Sabihin mo lang kung anong klaseng work ang hanap mo and kung may preferred country ka. Our team will help you check the available opportunities that may be a good fit for you.

From application hanggang sa next steps, we'll guide you through the process.
Your next opportunity may be closer than you think. PM mo kame, now na! 💛`,
  },
  {
    name: "DH",
    format: "flat", // flat Day001.png..Day365.png, loops via EPOCH_START
    folderId: requireEnv("ATW_DH_FOLDER_ID"),
    postTimeLocal: "08:00:00", // 8 AM Manila
    caption: `Gusto mo ba mag DH abroad pero hindi mo alam kung san mag uumpisa? Message mo kame! Tutulungan ka namen 💛

DMW License Number: 495-LB-02102025-R

📩 PM mo to samen: 

• Full Name
• Position Applying For: DH 
• Age
• Gender
• Preferred Country

Eto na yung sign na inaantay mo 💛`,
  },
  {
    name: "SKILLED",
    format: "flat",
    folderId: requireEnv("ATW_SKILLED_FOLDER_ID"),
    postTimeLocal: "20:00:00", // 8 PM Manila
    caption: `Gusto mo ba mag abroad? Your opportunity starts here.
We're hiring for multiple overseas positions - PM mo lang samen kung ano target role mo, baka meron kame for you! 💛

DMW License Number: 495-LB-02102025-R

📩 To fast-track your application, send us a DM with:

• Full Name
• Position Applying For
• Age
• Gender
• Preferred Country

Our team will contact you and guide you through the entire application process.`,
  },
];

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return v;
}

function addDaysToDateStr(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// FLAT format (DH, SKILLED): evergreen day-number math
// ---------------------------------------------------------------------------
// diffDays=0 (today)     -> 365
// diffDays=1 (tomorrow)  -> 1
// diffDays=2             -> 2   ...and so on, wrapping every 365 days.
function dayNumberForDate(dateStr) {
  const d = Date.parse(`${dateStr}T00:00:00Z`);
  const epoch = Date.parse(`${EPOCH_START}T00:00:00Z`);
  const diffDays = Math.round((d - epoch) / 86400000);
  return (((diffDays - 1) % 365) + 365) % 365 + 1;
}

// Parses "Day001.png" / "Day07.png" / "Day7.png" -> 1..365
function parseDayFilename(name) {
  const m = name.match(/^Day0*(\d{1,3})\.png$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (n < 1 || n > 365) return null;
  return n;
}

async function buildFlatDayMap(folderId) {
  const files = await listDriveFolderFiles(folderId);
  const map = {};
  for (const f of files) {
    const n = parseDayFilename(f.name);
    if (n === null) {
      console.warn(`  Skipping file with unexpected name: ${f.name}`);
      continue;
    }
    map[n] = { fileId: f.id, name: f.name };
  }
  return map;
}

// ---------------------------------------------------------------------------
// DATED format (ORIGINAL): year/month folders, monDD.png filenames,
// looped by matching month+day across whichever years exist.
// ---------------------------------------------------------------------------

// Parses "sep24.png" -> { monthAbbrev: "sep", day: 24 }
function parseDatedFilename(name) {
  const m = name.match(/^([a-z]{3})(\d{1,2})\.png$/i);
  if (!m) return null;
  return { monthAbbrev: m[1].toLowerCase(), day: parseInt(m[2], 10) };
}

// Builds a map keyed by "MM-DD" (year-agnostic) -> { fileId, sourceYear }.
// If the same month/day exists in more than one year folder, the highest
// (most recently added) year wins — so refreshing content for a specific
// date is just adding a newer year folder with that file, no deletion
// needed.
async function buildMonthDayMap(rootFolderId) {
  const map = {};
  const yearFolders = await listSubfolders(rootFolderId);

  for (const yearFolder of yearFolders) {
    if (!/^\d{4}$/.test(yearFolder.name)) {
      console.warn(`  Skipping non-year folder under ATW root: ${yearFolder.name}`);
      continue;
    }
    const year = parseInt(yearFolder.name, 10);
    const monthFolders = await listSubfolders(yearFolder.id);

    for (const monthFolder of monthFolders) {
      const monthKey = monthFolder.name.toLowerCase();
      const monthNumFromFullName = FULL_MONTH_TO_NUM[monthKey];
      if (!monthNumFromFullName) {
        console.warn(`  Skipping unrecognized month folder: ${yearFolder.name}/${monthFolder.name}`);
        continue;
      }

      const files = await listDriveFolderFiles(monthFolder.id);
      for (const f of files) {
        const parsed = parseDatedFilename(f.name);
        if (!parsed) {
          console.warn(`  Skipping file with unexpected name: ${yearFolder.name}/${monthFolder.name}/${f.name}`);
          continue;
        }
        const monthNumFromFile = MONTH_NUMBERS[parsed.monthAbbrev];
        if (!monthNumFromFile) {
          console.warn(`  Skipping file with unrecognized month abbreviation: ${f.name}`);
          continue;
        }
        const mdKey = `${monthNumFromFullName}-${String(parsed.day).padStart(2, "0")}`;
        const existing = map[mdKey];
        if (!existing || year > existing.sourceYear) {
          map[mdKey] = { fileId: f.id, sourceYear: year, name: f.name };
        }
      }
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Google Drive helpers (shared)
// ---------------------------------------------------------------------------
async function listSubfolders(folderId) {
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set(
    "q",
    `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  );
  url.searchParams.set("fields", "files(id,name)");
  url.searchParams.set("pageSize", "100");
  url.searchParams.set("key", DRIVE_API_KEY);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Drive folder list failed for ${folderId}: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.files || [];
}

async function listDriveFolderFiles(folderId) {
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", `'${folderId}' in parents and mimeType = 'image/png' and trashed = false`);
  url.searchParams.set("fields", "files(id,name)");
  url.searchParams.set("pageSize", "1000");
  url.searchParams.set("key", DRIVE_API_KEY);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Drive file list failed for folder ${folderId}: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.files || [];
}

// ---------------------------------------------------------------------------
// Buffer GraphQL helpers
// ---------------------------------------------------------------------------
async function bufferRequest(query, variables) {
  const res = await fetch(BUFFER_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${BUFFER_API_KEY}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (data.errors) {
    throw new Error(`Buffer API error: ${JSON.stringify(data.errors)}`);
  }
  return data.data;
}

async function getOrgScheduledPostLimit() {
  const query = `
    query Account {
      account {
        organizations {
          id
          limits { scheduledPosts }
        }
      }
    }
  `;
  const data = await bufferRequest(query, {});
  const org = data.account.organizations.find((o) => o.id === ORG_ID);
  return org ? org.limits.scheduledPosts : 10;
}

// Returns a Set of exact dueAt ISO timestamps (to the minute) already
// scheduled on this channel — used to de-dup across all three tracks
// sharing the same channel.
async function getScheduledDueAts(channelId) {
  const query = `
    query Posts($organizationId: OrganizationId!, $channelIds: [ChannelId!]) {
      posts(input: { organizationId: $organizationId, filter: { channelIds: $channelIds, status: [scheduled] } }, first: 100) {
        edges { node { dueAt } }
      }
    }
  `;
  const data = await bufferRequest(query, { organizationId: ORG_ID, channelIds: [channelId] });
  return new Set(data.posts.edges.map((e) => e.node.dueAt.slice(0, 16))); // to the minute
}

async function createPost({ channelId, fileId, dueAtIso, caption, altText }) {
  const mutation = `
    mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess { post { id status dueAt } }
        ... on LimitReachedError { message }
        ... on InvalidInputError { message }
        ... on UnexpectedError { message }
      }
    }
  `;
  const input = {
    channelId,
    mode: "customScheduled",
    schedulingType: "automatic",
    dueAt: dueAtIso,
    text: caption,
    metadata: { facebook: { type: "post" } },
    assets: [
      {
        image: {
          url: `https://lh3.googleusercontent.com/d/${fileId}`,
          metadata: { altText },
        },
      },
    ],
  };
  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would create post: dueAt=${dueAtIso}`);
    return;
  }
  const data = await bufferRequest(mutation, { input });
  const payload = data.createPost;
  if (payload.message) {
    throw new Error(`createPost failed: ${payload.message}`);
  }
  console.log(`  Scheduled: dueAt=${dueAtIso} -> post ${payload.post.id}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`Run started ${new Date().toISOString()}${DRY_RUN ? " [DRY RUN]" : ""}`);
  console.log(`Flat-track epoch: ${EPOCH_START} (today = Day 365, wraps to Day 1 tomorrow)`);

  const limit = await getOrgScheduledPostLimit();
  console.log(`Buffer scheduled-post limit for this channel: ${limit}`);

  const scheduledDueAts = await getScheduledDueAts(CHANNEL_ID);
  let scheduledCount = scheduledDueAts.size;
  console.log(`Channel ${CHANNEL_ID}: ${scheduledCount}/${limit} slots currently used (across all tracks).`);

  const today = new Date().toISOString().slice(0, 10);

  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 3;

  for (let offset = 0; offset < LOOKAHEAD_DAYS; offset++) {
    if (scheduledCount >= limit) {
      console.log(`Channel scheduled-post limit reached — stopping.`);
      break;
    }
    const dateStr = addDaysToDateStr(today, offset);

    for (const track of TRACKS) {
      if (scheduledCount >= limit) break;

      if (!track._dayMap) {
        console.log(`\n--- Track: ${track.name} (${track.format}) ---`);
        if (track.format === "flat") {
          track._dayMap = await buildFlatDayMap(track.folderId);
          console.log(`  Loaded ${Object.keys(track._dayMap).length} images from Drive.`);
        } else {
          track._dayMap = await buildMonthDayMap(track.folderId);
          console.log(`  Loaded ${Object.keys(track._dayMap).length} unique month/day slots from Drive.`);
        }
      }

      const dueAtIso = `${dateStr}T${track.postTimeLocal}${POST_UTC_OFFSET}`;
      const dueAtKey = dueAtIso.slice(0, 16);
      if (scheduledDueAts.has(dueAtKey)) continue;

      let entry, label;
      if (track.format === "flat") {
        const dayNum = dayNumberForDate(dateStr);
        entry = track._dayMap[dayNum];
        label = `Day${dayNum}`;
      } else {
        const mdKey = dateStr.slice(5);
        entry = track._dayMap[mdKey];
        label = mdKey;
      }

      if (!entry) {
        console.warn(`  [${track.name}] No image for ${label} (${dateStr}) — skipping.`);
        continue;
      }

      try {
        await createPost({
          channelId: CHANNEL_ID,
          fileId: entry.fileId,
          dueAtIso,
          caption: track.caption,
          altText: `Around The World Manpower Services — ${track.name} — ${label}`,
        });
        scheduledDueAts.add(dueAtKey);
        scheduledCount++;
        consecutiveFailures = 0;
      } catch (err) {
        console.error(`  [${track.name}] Failed to schedule ${dateStr} (${label}): ${err.message}`);
        consecutiveFailures++;
        if (/limit/i.test(err.message)) break;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          console.error(`  Stopping after ${consecutiveFailures} consecutive failures.`);
          break;
        }
      }
    }
  }

  console.log("\nRun complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
