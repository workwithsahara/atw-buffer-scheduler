#!/usr/bin/env node
/**
 * ATW → Buffer daily queue top-up
 * -----------------------------------------------------------------------
 * Standalone automation for "Around The World Manpower Services Inc" on
 * Facebook — a channel connected to the SAME Buffer account already used
 * for LAYA's LinkedIn + TikTok (Buffer's free plan allows up to 3
 * channels per account, and this was the 3rd open slot). Unrelated brand,
 * unrelated content, kept in its own repo/script on purpose so nothing
 * here can affect the LAYA automations or vice versa.
 *
 * Every post uses the SAME fixed caption (a recruitment ad) — this repo
 * does not read per-day captions from filenames like the LAYA repos do.
 * Only the image changes daily.
 *
 * Runs unattended (e.g. via GitHub Actions cron, or any daily cron job).
 * Each run:
 *   1. Discovers year folders under ATW_ROOT_FOLDER_ID (e.g. "2026", "2027"),
 *      then month folders under each year (e.g. "August"), then PNGs in each
 *      month folder. No folder IDs are hardcoded — add a new year or month
 *      folder in Drive and it's picked up automatically on the next run.
 *      Filenames are expected as "<monabbrev><DD>.png", e.g. "aug26.png".
 *   2. Figures out which dates are still missing from the Buffer queue.
 *   3. Schedules as many as the account's plan limit allows, earliest date
 *      first, never before ATW_MIN_DATE (2026-08-01 — first month posted).
 *   4. Posts at POST_TIME_LOCAL in POST_UTC_OFFSET, using the fixed caption
 *      defined in ATW_CAPTION below, with the day's image attached.
 *
 * Because Buffer plans cap total *scheduled* (not yet sent) posts, this
 * script is safe to run every day forever — as old posts publish, slots
 * free up and the next unscheduled day gets queued automatically.
 *
 * Required environment variables (set as repo/CI secrets):
 *   BUFFER_API_KEY        Personal API key for the Buffer account this
 *                         channel lives on
 *   BUFFER_ORG_ID         That Buffer account's organization ID
 *   BUFFER_CHANNEL_ID     The Facebook channel ID for this Page (single
 *                         channel, not a comma list — this repo posts to
 *                         one Page only)
 *   GOOGLE_DRIVE_API_KEY  API key with Drive API enabled (read-only is fine)
 *   ATW_ROOT_FOLDER_ID    Drive folder ID of the "Social Media" folder
 *                         (the one containing year folders like "2026")
 * Optional:
 *   ATW_MIN_DATE           Default "2026-08-01" — skip any date before this.
 *   POST_TIME_LOCAL        Default "19:00:00" (7 PM)
 *   POST_UTC_OFFSET        Default "+08:00" (Asia/Manila)
 *   DRY_RUN                 "true" to log without creating posts
 *
 * Requires Node.js 18+ (uses global fetch).
 */

const BUFFER_API_KEY = requireEnv("BUFFER_API_KEY");
const ORG_ID = requireEnv("BUFFER_ORG_ID");
const CHANNEL_ID = requireEnv("BUFFER_CHANNEL_ID");
const DRIVE_API_KEY = requireEnv("GOOGLE_DRIVE_API_KEY");
const ROOT_FOLDER_ID = requireEnv("ATW_ROOT_FOLDER_ID");

const MIN_DATE = process.env.ATW_MIN_DATE || "2026-08-01";
const POST_TIME_LOCAL = process.env.POST_TIME_LOCAL || "19:00:00"; // 7 PM
const POST_UTC_OFFSET = process.env.POST_UTC_OFFSET || "+08:00"; // Asia/Manila
const DRY_RUN = process.env.DRY_RUN === "true";

// Fixed caption used on every single post. Edit this directly (and commit)
// if the recruitment ad copy ever changes — it applies to every future post
// from the next run onward, not retroactively to already-scheduled ones.
const ATW_CAPTION = `Ready to work abroad? Your opportunity starts here.
We're hiring for multiple overseas positions in Malaysia, Bahrain, Qatar, and Saudi Arabia.
📩 To fast-track your application, send us a DM with:
• Full Name
• Position Applying For
• Age
• Gender
Our team will contact you and guide you through the entire application process.
Apply today and take the first step toward a brighter future!
#WorkAbroad #DomesticHelpers #CashierJobs #WaiterJobs #BabysitterJobs #NannyJobs #MidwifeJobs #CaregiverJobs #NurseJobs #CleanerJobs #MalaysiaJobs #BahrainJobs #QatarJobs #SaudiArabiaJobs`;

const MONTH_NUMBERS = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};
const FULL_MONTH_TO_NUM = {
  january: "01", february: "02", march: "03", april: "04",
  may: "05", june: "06", july: "07", august: "08",
  september: "09", october: "10", november: "11", december: "12",
};

const BUFFER_GRAPHQL_URL = "https://api.buffer.com/graphql";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return v;
}

// ---------------------------------------------------------------------------
// Google Drive helpers
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
  url.searchParams.set("pageSize", "100");
  url.searchParams.set("key", DRIVE_API_KEY);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Drive file list failed for folder ${folderId}: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.files || [];
}

// Parses "aug26.png" -> { monthAbbrev: "aug", day: 26 }
function parseFilename(name) {
  const m = name.match(/^([a-z]{3})(\d{1,2})\.png$/i);
  if (!m) return null;
  return { monthAbbrev: m[1].toLowerCase(), day: parseInt(m[2], 10) };
}

// Discovers ATW_ROOT_FOLDER_ID/<year>/<MonthFullName>/<monabbrev><DD>.png
// and builds a calendar: { "2026-08-26": { fileId }, ... }
async function buildCalendar() {
  const calendar = {};
  const yearFolders = await listSubfolders(ROOT_FOLDER_ID);

  for (const yearFolder of yearFolders) {
    if (!/^\d{4}$/.test(yearFolder.name)) {
      console.warn(`Skipping non-year folder under ATW root: ${yearFolder.name}`);
      continue;
    }
    const year = yearFolder.name;
    const monthFolders = await listSubfolders(yearFolder.id);

    for (const monthFolder of monthFolders) {
      const monthKey = monthFolder.name.toLowerCase();
      const monthNumFromFullName = FULL_MONTH_TO_NUM[monthKey];
      if (!monthNumFromFullName) {
        console.warn(`Skipping unrecognized month folder: ${year}/${monthFolder.name}`);
        continue;
      }

      const files = await listDriveFolderFiles(monthFolder.id);
      for (const f of files) {
        const parsed = parseFilename(f.name);
        if (!parsed) {
          console.warn(`Skipping file with unexpected name: ${year}/${monthFolder.name}/${f.name}`);
          continue;
        }
        const monthNumFromFile = MONTH_NUMBERS[parsed.monthAbbrev];
        if (!monthNumFromFile) {
          console.warn(`Skipping file with unrecognized month abbreviation: ${f.name}`);
          continue;
        }
        if (monthNumFromFile !== monthNumFromFullName) {
          console.warn(
            `Filename/folder month mismatch, using folder: ${year}/${monthFolder.name}/${f.name}`
          );
        }
        const dateKey = `${year}-${monthNumFromFullName}-${String(parsed.day).padStart(2, "0")}`;
        calendar[dateKey] = { fileId: f.id };
      }
    }
  }

  return calendar;
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

async function getScheduledDates(channelId) {
  const query = `
    query Posts($organizationId: OrganizationId!, $channelIds: [ChannelId!]) {
      posts(input: { organizationId: $organizationId, filter: { channelIds: $channelIds, status: [scheduled] } }, first: 100) {
        edges { node { dueAt } }
      }
    }
  `;
  const data = await bufferRequest(query, { organizationId: ORG_ID, channelIds: [channelId] });
  return new Set(data.posts.edges.map((e) => e.node.dueAt.slice(0, 10)));
}

async function createPost({ channelId, fileId, dueAtIso }) {
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
    text: ATW_CAPTION,
    metadata: { facebook: { type: "post" } }, // Facebook requires an explicit post type
    assets: [
      {
        image: {
          url: `https://lh3.googleusercontent.com/d/${fileId}`,
          metadata: { altText: "Around The World Manpower Services — job opening" },
        },
      },
    ],
  };
  if (DRY_RUN) {
    console.log(`[DRY RUN] Would create post: channel=${channelId} dueAt=${dueAtIso} (fixed caption)`);
    return;
  }
  const data = await bufferRequest(mutation, { input });
  const payload = data.createPost;
  if (payload.message) {
    throw new Error(`createPost failed: ${payload.message}`);
  }
  console.log(`Scheduled: channel=${channelId} dueAt=${dueAtIso} -> post ${payload.post.id}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`Run started ${new Date().toISOString()}${DRY_RUN ? " [DRY RUN]" : ""}`);

  const calendar = await buildCalendar();
  const sortedDates = Object.keys(calendar).sort();
  console.log(`Loaded ${sortedDates.length} days of content from Drive.`);

  const limit = await getOrgScheduledPostLimit();
  console.log(`Buffer scheduled-post limit per channel: ${limit}`);
  console.log(`Minimum date: ${MIN_DATE}`);

  const today = new Date().toISOString().slice(0, 10);

  const scheduledDates = await getScheduledDates(CHANNEL_ID);
  let scheduledCount = scheduledDates.size;
  console.log(`Channel ${CHANNEL_ID}: ${scheduledCount}/${limit} slots currently used.`);

  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 3;

  for (const dateKey of sortedDates) {
    if (scheduledCount >= limit) break;
    if (dateKey < today) continue;
    if (dateKey < MIN_DATE) continue;
    if (scheduledDates.has(dateKey)) continue;

    const { fileId } = calendar[dateKey];
    const dueAtIso = `${dateKey}T${POST_TIME_LOCAL}${POST_UTC_OFFSET}`;

    try {
      await createPost({ channelId: CHANNEL_ID, fileId, dueAtIso });
      scheduledCount++;
      consecutiveFailures = 0;
    } catch (err) {
      console.error(`Failed to schedule ${dateKey}: ${err.message}`);
      consecutiveFailures++;
      if (/limit/i.test(err.message)) break;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.error(`Stopping after ${consecutiveFailures} consecutive failures.`);
        break;
      }
    }
  }

  console.log("Run complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
