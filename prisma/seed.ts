/**
 * Seed script — fills a user account with rich showcase data.
 * Run with:  npx tsx prisma/seed.ts [username] [--force]
 *
 * --force  wipes all existing data for the user before re-seeding.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSQLite3 } from "@prisma/adapter-better-sqlite3";
import { deflateSync } from "zlib";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import path from "path";

const dbUrl = process.env.DATABASE_URL ?? "file:./dev.db";
const resolvedUrl = dbUrl.startsWith("file:./")
  ? `file:${path.resolve(process.cwd(), "prisma", dbUrl.slice(7))}`
  : dbUrl;
const adapter = new PrismaBetterSQLite3({ url: resolvedUrl });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter } as any);

const UPLOAD_DIR = join(process.cwd(), "data", "uploads");

// ── Date helpers ─────────────────────────────────────────────────────────────
const today = new Date();
const dateStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (n: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  return dateStr(d);
};
const daysFromNow = (n: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() + n);
  return dateStr(d);
};

// ── PNG generation ───────────────────────────────────────────────────────────
function crc32(buf: Buffer): number {
  const table: number[] = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u32be(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const tb = Buffer.from(type, "ascii");
  const crc = crc32(Buffer.concat([tb, data]));
  return Buffer.concat([u32be(data.length), tb, data, u32be(crc)]);
}

/** Generate a minimal valid 1×1 solid-color PNG. */
function solidColorPng(r: number, g: number, b: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  const rawScanline = Buffer.from([0, r, g, b]);
  const compressed = deflateSync(rawScanline);
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdrData),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// Palette of PNG bytes for different "categories" of images
const PNGS = {
  blue:   solidColorPng(99,  102, 241),
  green:  solidColorPng(16,  185, 129),
  amber:  solidColorPng(245, 158, 11),
  violet: solidColorPng(139, 92,  246),
  rose:   solidColorPng(244, 63,  94),
  slate:  solidColorPng(100, 116, 139),
  teal:   solidColorPng(20,  184, 166),
  sky:    solidColorPng(56,  189, 248),
};

async function writeUploadFile(name: string, content: Buffer): Promise<string> {
  if (!existsSync(UPLOAD_DIR)) await mkdir(UPLOAD_DIR, { recursive: true });
  const ext = name.split(".").pop() ?? "bin";
  const filename = `${randomBytes(16).toString("hex")}.${ext}`;
  await writeFile(join(UPLOAD_DIR, filename), content);
  return filename;
}

// ── Wipe helpers ─────────────────────────────────────────────────────────────
async function wipeUser(userId: string) {
  console.log("  Deleting existing data…");
  await prisma.habitCompletion.deleteMany({ where: { habit: { userId } } });
  await prisma.habit.deleteMany({ where: { userId } });
  await prisma.dailyGoal.deleteMany({ where: { userId } });
  await prisma.dailyReflection.deleteMany({ where: { userId } });
  await prisma.attachment.deleteMany({ where: { userId } });
  await prisma.upload.deleteMany({ where: { userId } });
  await prisma.fileFolder.deleteMany({ where: { userId } });
  await prisma.note.deleteMany({ where: { userId } });
  await prisma.folder.deleteMany({ where: { userId } });
  await prisma.task.deleteMany({ where: { project: { userId } } });
  await prisma.project.deleteMany({ where: { userId } });
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const targetUsername = args.find((a) => !a.startsWith("--")) ?? null;

  let user = targetUsername
    ? await prisma.user.findUnique({ where: { username: targetUsername } })
    : await prisma.user.findFirst();

  if (!user) {
    console.log("No users found — creating demo user (username: demo, password: demo1234)");
    const passwordHash = await bcrypt.hash("demo1234", 12);
    const recoveryCodeHash = await bcrypt.hash("DEMO-RECOVERY-CODE", 12);
    user = await prisma.user.create({
      data: { username: "demo", passwordHash, recoveryCodeHash },
    });
  }

  console.log(`Seeding for user: ${user.username} (${user.id})`);

  const existingProjects = await prisma.project.count({ where: { userId: user.id } });
  if (existingProjects > 0 && !force) {
    console.log(`User already has ${existingProjects} projects — skipping seed.`);
    console.log("Re-run with --force to wipe and re-seed.");
    return;
  }

  if (force) await wipeUser(user.id);

  // ── Projects ───────────────────────────────────────────────────────────────
  const [launch, finance, reno, learning, health] = await Promise.all([
    prisma.project.create({ data: { name: "Product Launch",    color: "#6366f1", userId: user.id } }),
    prisma.project.create({ data: { name: "Personal Finance",  color: "#10b981", userId: user.id } }),
    prisma.project.create({ data: { name: "Home Renovation",   color: "#f59e0b", userId: user.id } }),
    prisma.project.create({ data: { name: "Learning & Growth", color: "#8b5cf6", userId: user.id } }),
    prisma.project.create({ data: { name: "Health & Fitness",  color: "#f43f5e", userId: user.id } }),
  ]);
  console.log("✓ 5 projects created");

  // ── Tasks ──────────────────────────────────────────────────────────────────
  const tasks = [
    // Product Launch
    { title: "Define MVP feature set",            stage: "todo",        priority: "high",   projectId: launch.id,   position: 1000, dueDate: daysFromNow(7),  description: "<p>Work with the PM to finalise the feature list for v1.0. Must have clear acceptance criteria for each item.</p>" },
    { title: "Write launch email campaign",       stage: "todo",        priority: "medium", projectId: launch.id,   position: 2000, dueDate: daysFromNow(14) },
    { title: "Set up analytics tracking",         stage: "todo",        priority: "medium", projectId: launch.id,   position: 3000 },
    { title: "Create onboarding walkthrough",     stage: "todo",        priority: "low",    projectId: launch.id,   position: 4000 },
    { title: "Build user dashboard",              stage: "in_progress", priority: "high",   projectId: launch.id,   position: 1000, description: "<p>Implement the main dashboard view with activity feed, quick stats, and recent items.</p><ul><li>Activity timeline</li><li>Key metrics cards</li><li>Recent projects sidebar</li></ul>" },
    { title: "Design landing page",               stage: "in_progress", priority: "high",   projectId: launch.id,   position: 2000, dueDate: daysFromNow(5) },
    { title: "Write API documentation",           stage: "in_progress", priority: "medium", projectId: launch.id,   position: 3000 },
    { title: "Finalize pricing strategy",         stage: "blocked",     priority: "high",   projectId: launch.id,   position: 1000, description: "<p>Blocked: waiting on competitive analysis from marketing team. Need benchmarks before we can set tiers.</p>" },
    { title: "Register domain name",              stage: "done",        priority: "low",    projectId: launch.id,   position: 1000 },
    { title: "Set up CI/CD pipeline",             stage: "done",        priority: "high",   projectId: launch.id,   position: 2000 },
    { title: "Choose tech stack",                 stage: "done",        priority: "high",   projectId: launch.id,   position: 3000 },

    // Personal Finance
    { title: "Research index fund options",       stage: "todo",        priority: "medium", projectId: finance.id,  position: 1000, dueDate: daysFromNow(10), description: "<p>Compare Vanguard vs Fidelity vs Schwab. Focus on expense ratios and tax efficiency.</p>" },
    { title: "Review life insurance coverage",    stage: "todo",        priority: "high",   projectId: finance.id,  position: 2000 },
    { title: "Set up a will and trust",           stage: "todo",        priority: "medium", projectId: finance.id,  position: 3000 },
    { title: "Negotiate lower cable/internet bill", stage: "todo",      priority: "low",    projectId: finance.id,  position: 4000 },
    { title: "Build 6-month emergency fund",      stage: "in_progress", priority: "high",   projectId: finance.id,  position: 1000, description: "<p>Target: $18,000. Currently at $11,200. Contributing $500/month.</p><p>On track to complete in ~14 months.</p>" },
    { title: "Pay down credit card debt",         stage: "in_progress", priority: "high",   projectId: finance.id,  position: 2000, dueDate: daysFromNow(60) },
    { title: "Open Roth IRA",                     stage: "done",        priority: "high",   projectId: finance.id,  position: 1000 },
    { title: "Cancel 3 unused subscriptions",     stage: "done",        priority: "low",    projectId: finance.id,  position: 2000 },
    { title: "Consolidate bank accounts",         stage: "done",        priority: "medium", projectId: finance.id,  position: 3000 },

    // Home Renovation
    { title: "Get 3 contractor quotes",           stage: "todo",        priority: "high",   projectId: reno.id,     position: 1000, dueDate: daysFromNow(14), description: "<p>Need quotes from at least 3 licensed contractors for kitchen and bathroom remodel.</p><p>Ask about timeline, materials, and warranty.</p>" },
    { title: "Choose paint colors",               stage: "todo",        priority: "low",    projectId: reno.id,     position: 2000 },
    { title: "Order new kitchen appliances",      stage: "todo",        priority: "medium", projectId: reno.id,     position: 3000, dueDate: daysFromNow(30) },
    { title: "Source bathroom vanity",            stage: "todo",        priority: "low",    projectId: reno.id,     position: 4000 },
    { title: "Kitchen cabinet refinishing",       stage: "in_progress", priority: "high",   projectId: reno.id,     position: 1000, description: "<p>Contractor is repainting and rehinging all cabinet doors. Week 2 of 3.</p>" },
    { title: "Replace bathroom floor tiles",      stage: "in_progress", priority: "medium", projectId: reno.id,     position: 2000 },
    { title: "Back patio extension",              stage: "blocked",     priority: "medium", projectId: reno.id,     position: 1000, description: "<p>City permit application submitted 3 weeks ago. Estimated 2-4 more weeks for approval.</p>" },
    { title: "Fix garage door",                   stage: "done",        priority: "high",   projectId: reno.id,     position: 1000 },
    { title: "Install smart thermostat",          stage: "done",        priority: "medium", projectId: reno.id,     position: 2000 },
    { title: "Pressure-wash driveway",            stage: "done",        priority: "low",    projectId: reno.id,     position: 3000 },

    // Learning & Growth
    { title: "Complete TypeScript advanced course", stage: "todo",      priority: "high",   projectId: learning.id, position: 1000, dueDate: daysFromNow(21) },
    { title: "Read 'Staff Engineer' book",        stage: "todo",        priority: "medium", projectId: learning.id, position: 2000 },
    { title: "Take AWS Solutions Architect exam", stage: "todo",        priority: "high",   projectId: learning.id, position: 3000, dueDate: daysFromNow(45) },
    { title: "Write one blog post per month",     stage: "todo",        priority: "low",    projectId: learning.id, position: 4000 },
    { title: "Learn Rust basics",                 stage: "in_progress", priority: "medium", projectId: learning.id, position: 1000, description: "<p>Working through 'The Rust Book'. Currently on chapter 8 — collections and error handling.</p>" },
    { title: "Build a CLI tool in Go",            stage: "in_progress", priority: "low",    projectId: learning.id, position: 2000 },
    { title: "Finish 'Deep Work' by Cal Newport", stage: "done",        priority: "medium", projectId: learning.id, position: 1000 },
    { title: "Complete system design course",     stage: "done",        priority: "high",   projectId: learning.id, position: 2000 },
    { title: "Earn Google Cloud cert",            stage: "done",        priority: "medium", projectId: learning.id, position: 3000 },

    // Health & Fitness
    { title: "Sign up for a 5K race",             stage: "todo",        priority: "medium", projectId: health.id,   position: 1000, dueDate: daysFromNow(7) },
    { title: "Schedule annual physical",          stage: "todo",        priority: "high",   projectId: health.id,   position: 2000 },
    { title: "Research sleep tracking device",    stage: "todo",        priority: "low",    projectId: health.id,   position: 3000 },
    { title: "Couch-to-5K running program",       stage: "in_progress", priority: "high",   projectId: health.id,   position: 1000, description: "<p>Week 5 of 8. Running 20 min without stopping now. Target race is June 28th.</p>" },
    { title: "30-day clean eating challenge",     stage: "in_progress", priority: "medium", projectId: health.id,   position: 2000, dueDate: daysFromNow(12) },
    { title: "Switch to outdoor gym",             stage: "done",        priority: "medium", projectId: health.id,   position: 1000 },
    { title: "Establish morning routine",         stage: "done",        priority: "high",   projectId: health.id,   position: 2000 },
    { title: "Cut out daily coffee after 2pm",   stage: "done",        priority: "low",    projectId: health.id,   position: 3000 },
  ];

  await prisma.task.createMany({ data: tasks });
  console.log(`✓ ${tasks.length} tasks created`);

  // ── Note Folders ───────────────────────────────────────────────────────────
  const [meetingFolder, resourcesFolder, templatesFolder] = await Promise.all([
    prisma.folder.create({ data: { name: "Meeting Notes", userId: user.id } }),
    prisma.folder.create({ data: { name: "Resources",    userId: user.id } }),
    prisma.folder.create({ data: { name: "Templates",    userId: user.id, pinned: true } }),
  ]);
  console.log("✓ 3 note folders created");

  // ── Notes ──────────────────────────────────────────────────────────────────
  const notes = [
    {
      title: "Q3 Product Roadmap",
      pinned: true,
      starred: true,
      folderId: meetingFolder.id,
      projectId: launch.id,
      content: `<h2>Q3 Priorities</h2><p>Agreed with leadership on the following focus areas for Q3:</p><ol><li><strong>User dashboard</strong> — the #1 retention driver based on user research</li><li><strong>Performance</strong> — p95 API latency needs to drop below 200ms</li><li><strong>Mobile</strong> — iOS and Android beta by end of August</li></ol><h3>Key decisions</h3><ul><li>Defer analytics dashboard to Q4 — scope risk too high</li><li>Ship monthly billing only; annual billing is a Q4 addition</li><li>Design system refactor happens in parallel, not blocking features</li></ul><h3>Open questions</h3><ul><li>Do we self-host or use Vercel for the mobile backend?</li><li>Who owns QA for the mobile beta?</li></ul>`,
    },
    {
      title: "Team Retrospective — June Sprint",
      folderId: meetingFolder.id,
      content: `<h3>What went well</h3><ul><li>Shipped the file uploads feature ahead of schedule</li><li>Zero production incidents this sprint</li><li>New onboarding docs cut support tickets by 30%</li></ul><h3>What could improve</h3><ul><li>Too many context switches mid-sprint — need stricter WIP limits</li><li>PR review cycle was slow; aim for 24h turnaround</li><li>Standup running long — try async updates on Tuesdays</li></ul><h3>Action items</h3><ol><li>Add WIP limit of 2 per person to the board <strong>(Jordan)</strong></li><li>Set up a PR review rotation <strong>(Alex)</strong></li><li>Try async standup for 2 weeks <strong>(Team)</strong></li></ol>`,
    },
    {
      title: "Database Architecture Decision",
      folderId: resourcesFolder.id,
      projectId: launch.id,
      content: `<h2>Decision: SQLite with Litestream for replication</h2><p>After evaluating Postgres, MySQL, and SQLite, we chose SQLite + Litestream for the following reasons:</p><h3>Pros</h3><ul><li>Zero operational overhead for self-hosted deployments</li><li>Single-file database makes backups trivial</li><li>Litestream provides continuous replication to S3 with sub-second RPO</li><li>Surprisingly great performance for our read-heavy workload</li></ul><h3>Cons</h3><ul><li>Write concurrency limited (WAL mode helps significantly)</li><li>Not ideal if we ever need multi-region writes</li></ul><h3>Mitigation</h3><p>We can migrate to PlanetScale or Turso (distributed SQLite) if write concurrency becomes a bottleneck at scale.</p>`,
    },
    {
      title: "Tech Interview Study Guide",
      folderId: resourcesFolder.id,
      projectId: learning.id,
      content: `<h2>System Design</h2><ul><li>URL shortener (consistent hashing, caching)</li><li>Notification service (fan-out, message queues)</li><li>Rate limiter (token bucket vs sliding window)</li><li>Chat application (WebSockets, presence, message delivery)</li></ul><h2>Algorithms</h2><p>Focus areas for the next 4 weeks:</p><ol><li>Dynamic programming — 3 problems/day</li><li>Graph traversal — BFS, DFS, Dijkstra</li><li>Sliding window and two-pointer patterns</li><li>Binary search on sorted arrays</li></ol><h2>Behavioural</h2><p>Prepare 3 STAR stories each for: leadership, conflict resolution, failure, and innovation.</p>`,
    },
    {
      title: "Weekly Review Template",
      pinned: true,
      folderId: templatesFolder.id,
      content: `<h2>Weekly Review</h2><h3>Wins this week 🎉</h3><p>What did I accomplish that I'm proud of?</p><p>...</p><h3>Challenges</h3><p>What was hard? What did I learn from it?</p><p>...</p><h3>Energy check</h3><p>Rate your energy 1–10 this week and explain why.</p><p>...</p><h3>Next week's top 3</h3><ol><li>...</li><li>...</li><li>...</li></ol><h3>Habits score</h3><p>How many days did I hit each habit? What's one tweak for next week?</p><p>...</p>`,
    },
    {
      title: "Daily Journaling Prompts",
      folderId: templatesFolder.id,
      content: `<h2>Morning prompts</h2><ul><li>What am I grateful for today?</li><li>What's the one thing that would make today great?</li><li>What's one thing I want to let go of?</li></ul><h2>Evening prompts</h2><ul><li>What was my biggest win today?</li><li>What drained my energy?</li><li>What's one thing I'd do differently?</li><li>Did I show up as my best self today?</li></ul><h2>Deeper reflection (weekly)</h2><ul><li>Am I moving toward the life I want?</li><li>Who do I need to reconnect with?</li><li>What habit is serving me best right now?</li></ul>`,
    },
    {
      title: "Investment Thesis",
      starred: true,
      projectId: finance.id,
      content: `<h2>My investment philosophy</h2><p>Long-term, index-first approach. No individual stock picking except for a small "fun money" allocation (max 5% of portfolio).</p><h3>Asset allocation (target)</h3><ul><li><strong>60%</strong> — US total market index (VTI)</li><li><strong>20%</strong> — International developed markets (VXUS)</li><li><strong>10%</strong> — Bonds (BND)</li><li><strong>5%</strong> — Real estate (VNQ)</li><li><strong>5%</strong> — Individual stocks / speculative</li></ul><h3>Rules I follow</h3><ol><li>Never time the market — automate contributions</li><li>Rebalance once per year (tax-loss harvest at the same time)</li><li>Max out tax-advantaged accounts first: 401k → Roth IRA → HSA</li><li>Never sell during a drawdown of less than 30%</li></ol>`,
    },
    {
      title: "Kitchen Renovation Mood Board",
      projectId: reno.id,
      content: `<h2>Vision</h2><p>Open-concept, Scandinavian-modern. Light wood tones, white quartz countertops, matte black fixtures.</p><h3>Materials list</h3><ul><li><strong>Cabinets:</strong> IKEA SEKTION with custom doors (Semihandmade)</li><li><strong>Countertop:</strong> Calacatta Laza quartz from MSI</li><li><strong>Backsplash:</strong> Zellige tile in off-white</li><li><strong>Sink:</strong> Kohler undermount farmhouse</li><li><strong>Faucet:</strong> Delta Trinsic matte black</li></ul><h3>Appliances</h3><ul><li>Samsung Bespoke French door fridge</li><li>Bosch 800 series dishwasher</li><li>GE Profile induction range</li></ul><h3>Budget estimate</h3><p>Cabinets + install: ~$8,000 | Counters: ~$4,000 | Appliances: ~$5,000 | Labour: ~$6,000</p><p><strong>Total: ~$23,000</strong></p>`,
    },
    {
      title: "Reading List 2026",
      starred: true,
      content: `<h2>Currently reading</h2><ul><li><strong>Staff Engineer</strong> — Will Larson ⭐⭐⭐⭐</li></ul><h2>Up next</h2><ol><li>The Pragmatic Programmer (20th anniversary ed.) — Hunt & Thomas</li><li>Building a Second Brain — Tiago Forte</li><li>Never Split the Difference — Chris Voss</li><li>Range — David Epstein</li></ol><h2>Finished this year</h2><ul><li>✅ Deep Work — Cal Newport</li><li>✅ Atomic Habits — James Clear</li><li>✅ The Mom Test — Rob Fitzpatrick</li><li>✅ Shape Up — Ryan Singer</li><li>✅ An Elegant Puzzle — Will Larson</li></ul>`,
    },
    {
      title: "Fitness Milestones",
      projectId: health.id,
      content: `<h2>Running</h2><ul><li>✅ Run 1 mile without stopping</li><li>✅ Complete week 3 of C25K</li><li>✅ Run 20 minutes continuously</li><li>⬜ Run 5K (target: June 28)</li><li>⬜ Run 10K (target: September)</li></ul><h2>Strength</h2><ul><li>✅ 10 consecutive pull-ups</li><li>✅ 50kg bench press</li><li>⬜ 80kg bench press</li><li>⬜ 100 consecutive push-ups</li></ul><h2>Weight</h2><p>Start: 84kg → Current: 79kg → Target: 75kg</p><p>Trend: −0.5kg/week — on track for 8 weeks to goal.</p>`,
    },
    {
      title: "Home Budget — June 2026",
      projectId: finance.id,
      content: `<h2>Monthly Budget</h2><table><tbody><tr><td><strong>Category</strong></td><td><strong>Budget</strong></td><td><strong>Actual</strong></td></tr><tr><td>Rent / mortgage</td><td>$2,200</td><td>$2,200</td></tr><tr><td>Groceries</td><td>$600</td><td>$540</td></tr><tr><td>Utilities</td><td>$180</td><td>$195</td></tr><tr><td>Transport</td><td>$200</td><td>$210</td></tr><tr><td>Dining out</td><td>$300</td><td>$420 ⚠️</td></tr><tr><td>Entertainment</td><td>$150</td><td>$90</td></tr><tr><td>Savings</td><td>$800</td><td>$800</td></tr></tbody></table><p>Dining out is the only category over budget. Cut one restaurant night per week.</p>`,
    },
    {
      title: "Side Project Ideas",
      content: `<h2>Ideas worth exploring</h2><ol><li><strong>AI meal planner</strong> — generates grocery lists from dietary goals, outputs Instacart order</li><li><strong>Habit tracker with accountability partners</strong> — share streaks, gentle nudges</li><li><strong>Freelancer invoicing</strong> — simple, clean, no subscription. One-time purchase.</li><li><strong>Focus timer + Spotify</strong> — auto-plays focus playlist, pauses on break</li><li><strong>Recipe box manager</strong> — import from URL, auto-scale servings, generate shopping list</li></ol><h2>Most promising</h2><p>The freelancer invoicing tool has the clearest monetization path and least competition in the "simple, beautiful, one-time purchase" niche.</p>`,
    },
  ];

  await prisma.note.createMany({
    data: notes.map((n) => ({ ...n, userId: user!.id })),
  });
  console.log(`✓ ${notes.length} notes created`);

  // ── Habits ─────────────────────────────────────────────────────────────────
  const habitDefs = [
    { text: "Morning meditation (10 min)", position: 0 },
    { text: "Exercise / move body",        position: 1 },
    { text: "Read 30 pages",               position: 2 },
    { text: "Drink 8 glasses of water",    position: 3 },
    { text: "Journal before bed",          position: 4 },
    { text: "No screens after 10pm",       position: 5 },
  ];

  const habits = await Promise.all(
    habitDefs.map((h) => prisma.habit.create({ data: { ...h, userId: user!.id } }))
  );

  // Completion pattern: first 4 habits have strong streaks, last 2 are more sporadic
  const completionPattern: boolean[][] = [
    [true,  true,  true,  true,  true,  true,  true],  // meditation — every day
    [true,  true,  false, true,  true,  true,  false], // exercise — 5/7
    [true,  false, true,  true,  false, true,  true],  // reading — 5/7
    [true,  true,  true,  false, true,  true,  true],  // water — 6/7
    [false, true,  true,  false, false, true,  false], // journal — 3/7
    [false, false, true,  false, true,  false, false], // no screens — 2/7
  ];

  for (let hi = 0; hi < habits.length; hi++) {
    for (let day = 0; day < 7; day++) {
      if (completionPattern[hi][day]) {
        await prisma.habitCompletion.create({
          data: { habitId: habits[hi].id, date: daysAgo(day) },
        }).catch(() => {}); // ignore duplicate on day 0 if run twice
      }
    }
  }
  console.log(`✓ ${habits.length} habits created with 7-day history`);

  // ── Daily Goals ────────────────────────────────────────────────────────────
  const goalsToday = [
    { text: "Write API docs for the files endpoint",    completed: true,  position: 0 },
    { text: "Call contractor for kitchen quote",        completed: false, position: 1 },
    { text: "30 min run — week 5 of C25K",              completed: true,  position: 2 },
    { text: "Review Q3 roadmap with PM",                completed: false, position: 3 },
    { text: "Pay credit card bill",                     completed: true,  position: 4 },
    { text: "Read 30 pages of Staff Engineer",          completed: false, position: 5 },
  ];
  const goalsYesterday = [
    { text: "Finish onboarding flow PR",                completed: true,  position: 0 },
    { text: "Grocery shopping",                         completed: true,  position: 1 },
    { text: "Reply to contractor emails",               completed: true,  position: 2 },
    { text: "Meditate",                                 completed: false, position: 3 },
  ];

  await prisma.dailyGoal.createMany({
    data: [
      ...goalsToday.map((g) => ({ ...g, date: dateStr(today), userId: user!.id })),
      ...goalsYesterday.map((g) => ({ ...g, date: daysAgo(1), userId: user!.id })),
    ],
  });
  console.log(`✓ ${goalsToday.length + goalsYesterday.length} daily goals created`);

  // ── Journal / Daily Reflections ────────────────────────────────────────────
  const reflections = [
    {
      date: daysAgo(1),
      note: "Block 9–11am for deep work — protect it like a meeting",
      gratitude: "Got into a 2-hour flow state this morning — rare and wonderful",
      body: "Solid day. Shipped the file upload PR and got positive feedback in the review. Energy was high in the morning, predictably dipped after lunch. The afternoon walk helped reset — going to make that a daily habit. Dinner was simple but good. Evening was calm; read 40 pages before bed.",
    },
    {
      date: daysAgo(2),
      note: "Plan tomorrow's tasks the night before instead of figuring it out in the morning",
      gratitude: "A long run that actually felt good for the first time in weeks",
      body: "Felt scattered today — too many context switches. Meetings ran long and I didn't get to deep work until 4pm. The run after work genuinely helped reset my mood. Finished the TypeScript chapter on generics. Looking forward to a more structured day tomorrow.",
    },
    {
      date: daysAgo(3),
      note: "Say no to non-urgent interruptions during the morning focus block",
      gratitude: "Finally got the concept of Rust's ownership model — it just clicked",
      body: "Great progress on the dashboard feature. Got into a flow state in the morning that lasted nearly 3 hours — rare and valuable. Kitchen cabinet work is coming along well; contractor expects to finish by end of week. Habits were strong today: meditation, run, and 30 pages done.",
    },
    {
      date: daysAgo(4),
      note: "Write down one win at the end of each workday — don't let good work go unnoticed",
      gratitude: "My partner cooked an amazing dinner after a tough day — felt cared for",
      body: "Mostly a maintenance day — code review, emails, and documentation. Not glamorous but necessary. Finished the weekly review template in the notes app. Had a good call with the contractor about the kitchen timeline. Energy was middling; need to watch the caffeine after 2pm.",
    },
    {
      date: daysAgo(5),
      note: "Take a proper lunch break away from the screen — even 20 minutes makes a difference",
      gratitude: "Team appreciated the detailed PR review I gave — small things matter",
      body: "Sprint ended today. Wrapped up two features that felt stuck earlier in the week. The C25K run was tough — legs are sore — but I'm proud I pushed through. Reviewed the budget and realised I've been overspending on dining out. Will cut one restaurant night per week.",
    },
    {
      date: daysAgo(6),
      note: "Set a hard stop time at 6pm — work expands to fill the time you give it",
      gratitude: "Sunny morning run in the park — good for the soul",
      body: "Good momentum today. Made a dent in the Rust book and wrote a small CLI tool as a learning exercise. Had a productive retrospective with the team — the WIP limits idea got traction and we'll try it next sprint. Bed by 10pm — feeling rested.",
    },
    {
      date: daysAgo(7),
      note: "Start each week with a clear list of the 3 most important things to accomplish",
      gratitude: "Kickoff meeting went better than expected — everyone aligned and energised",
      body: "Start of a new sprint. Kickoff went smoothly — team is aligned on Q3 priorities. Cleared my backlog and set up the task board for the week. The home renovation is starting to feel real: contractor starts on the kitchen cabinets this week. Feeling genuinely motivated.",
    },
  ];

  await prisma.dailyReflection.createMany({
    data: reflections.map((r) => ({ ...r, userId: user!.id })),
  });
  console.log(`✓ ${reflections.length} journal entries created`);

  // ── File Folders ───────────────────────────────────────────────────────────
  const [designFolder, screenshotsFolder, docsFolder] = await Promise.all([
    prisma.fileFolder.create({ data: { name: "Design Assets", userId: user!.id } }),
    prisma.fileFolder.create({ data: { name: "Screenshots",   userId: user!.id } }),
    prisma.fileFolder.create({ data: { name: "Documents",     userId: user!.id } }),
  ]);
  const mockupsFolder = await prisma.fileFolder.create({
    data: { name: "Mockups", parentId: designFolder.id, userId: user!.id },
  });
  console.log("✓ 4 file folders created");

  // ── Files (uploads) ────────────────────────────────────────────────────────
  interface UploadSpec {
    originalName: string;
    content: Buffer;
    mimeType: string;
    folderId: string | null;
  }

  const textFile = (text: string) => Buffer.from(text, "utf8");
  const minimalPdf = () => Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type /Catalog /Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type /Pages /Kids [3 0 R] /Count 1>>endobj\n" +
    "3 0 obj<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]>>endobj\n" +
    "xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n" +
    "0000000058 00000 n \n0000000115 00000 n \n" +
    "trailer<</Size 4 /Root 1 0 R>>\nstartxref\n190\n%%EOF\n",
    "utf8"
  );

  const uploadSpecs: UploadSpec[] = [
    // Design Assets
    { originalName: "logo-v3.png",           content: PNGS.blue,   mimeType: "image/png", folderId: designFolder.id },
    { originalName: "brand-colors.png",      content: PNGS.violet, mimeType: "image/png", folderId: designFolder.id },
    { originalName: "hero-banner.png",       content: PNGS.sky,    mimeType: "image/png", folderId: designFolder.id },
    { originalName: "favicon.png",           content: PNGS.blue,   mimeType: "image/png", folderId: designFolder.id },
    { originalName: "icon-set.png",          content: PNGS.slate,  mimeType: "image/png", folderId: designFolder.id },
    // Mockups (subfolder of Design Assets)
    { originalName: "dashboard-mockup.png",  content: PNGS.teal,   mimeType: "image/png", folderId: mockupsFolder.id },
    { originalName: "onboarding-flow.png",   content: PNGS.green,  mimeType: "image/png", folderId: mockupsFolder.id },
    { originalName: "mobile-screens.png",    content: PNGS.rose,   mimeType: "image/png", folderId: mockupsFolder.id },
    { originalName: "settings-page.png",     content: PNGS.amber,  mimeType: "image/png", folderId: mockupsFolder.id },
    // Screenshots
    { originalName: "app-screenshot-1.png",  content: PNGS.blue,   mimeType: "image/png", folderId: screenshotsFolder.id },
    { originalName: "app-screenshot-2.png",  content: PNGS.teal,   mimeType: "image/png", folderId: screenshotsFolder.id },
    { originalName: "dark-mode-preview.png", content: PNGS.slate,  mimeType: "image/png", folderId: screenshotsFolder.id },
    { originalName: "mobile-preview.png",    content: PNGS.violet, mimeType: "image/png", folderId: screenshotsFolder.id },
    // Documents
    {
      originalName: "project-spec.txt",
      mimeType: "text/plain",
      folderId: docsFolder.id,
      content: textFile(
        "Product Launch — Technical Specification\n" +
        "===========================================\n\n" +
        "Version: 1.2  |  Author: Alex Chen  |  Updated: June 2026\n\n" +
        "OVERVIEW\n" +
        "This document describes the technical requirements for the v1.0 launch.\n\n" +
        "ARCHITECTURE\n" +
        "- Backend: Next.js 16 API routes, SQLite + Litestream\n" +
        "- Frontend: React 19, MUI v6, TailwindCSS v4\n" +
        "- Auth: JWT + bcrypt, optional WebAuthn\n" +
        "- Hosting: Self-hosted Docker, optional Vercel\n\n" +
        "PERFORMANCE TARGETS\n" +
        "- p95 API latency < 200ms\n" +
        "- First Contentful Paint < 1.5s on 4G\n" +
        "- Lighthouse score > 90\n"
      ),
    },
    {
      originalName: "meeting-notes-q3-kickoff.txt",
      mimeType: "text/plain",
      folderId: docsFolder.id,
      content: textFile(
        "Q3 Kickoff Meeting Notes\n" +
        "Date: June 3, 2026\n" +
        "Attendees: Alex, Jordan, Sam, Taylor\n\n" +
        "AGENDA\n" +
        "1. Sprint goals review\n" +
        "2. Q3 roadmap alignment\n" +
        "3. Team capacity and blockers\n\n" +
        "NOTES\n" +
        "- Dashboard feature is the top priority — user research shows it's the #1 retention driver\n" +
        "- Mobile beta pushed to end of August (capacity constraint)\n" +
        "- Analytics dashboard deferred to Q4\n\n" +
        "ACTION ITEMS\n" +
        "- Alex: finalize dashboard API contracts by June 10\n" +
        "- Jordan: set up CI/CD for mobile builds\n" +
        "- Sam: user research report by June 7\n"
      ),
    },
    {
      originalName: "roadmap-2026.txt",
      mimeType: "text/plain",
      folderId: docsFolder.id,
      content: textFile(
        "Product Roadmap 2026\n" +
        "====================\n\n" +
        "Q1 (SHIPPED)\n" +
        "[x] Core task board\n" +
        "[x] Notes with rich text\n" +
        "[x] Daily journal\n" +
        "[x] Habit tracker\n\n" +
        "Q2 (SHIPPED)\n" +
        "[x] File uploads + gallery\n" +
        "[x] Global search\n" +
        "[x] Mobile app beta\n" +
        "[x] E2E encryption (vault)\n\n" +
        "Q3 (IN PROGRESS)\n" +
        "[ ] User dashboard with activity feed\n" +
        "[ ] Mobile app v1.0 (iOS + Android)\n" +
        "[ ] Performance pass — p95 < 200ms\n" +
        "[ ] Onboarding walkthrough\n\n" +
        "Q4 (PLANNED)\n" +
        "[ ] Analytics dashboard\n" +
        "[ ] Team workspaces\n" +
        "[ ] Annual billing\n" +
        "[ ] API for third-party integrations\n"
      ),
    },
    // Root-level files
    { originalName: "profile-photo.png",     content: PNGS.green,  mimeType: "image/png", folderId: null },
    { originalName: "cover-image.png",       content: PNGS.blue,   mimeType: "image/png", folderId: null },
    { originalName: "sketch-ideas.png",      content: PNGS.amber,  mimeType: "image/png", folderId: null },
  ];

  for (const spec of uploadSpecs) {
    const filename = await writeUploadFile(spec.originalName, spec.content);
    await prisma.upload.create({
      data: {
        filename,
        originalName: spec.originalName,
        mimeType: spec.mimeType,
        size: spec.content.length,
        userId: user!.id,
        fileFolderId: spec.folderId,
      },
    });
  }
  console.log(`✓ ${uploadSpecs.length} files created (${uploadSpecs.filter(s => s.mimeType === "image/png").length} images, ${uploadSpecs.filter(s => s.mimeType !== "image/png").length} documents)`);

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("\n🎉 Seed complete!");
  console.log(`   User:     ${user.username}`);
  console.log(`   Projects: 5  |  Tasks: ${tasks.length}`);
  console.log(`   Notes: ${notes.length}  |  Folders: 3`);
  console.log(`   Habits: ${habits.length} (7-day history)  |  Goals: ${goalsToday.length + goalsYesterday.length}`);
  console.log(`   Journal entries: ${reflections.length}  |  Files: ${uploadSpecs.length}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
