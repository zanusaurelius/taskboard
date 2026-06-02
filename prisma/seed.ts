/**
 * Seed script — populates test data for the first user in the database.
 * Run with:  npx tsx prisma/seed.ts
 *
 * Safe to re-run: skips seeding if the user already has projects.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSQLite3 } from "@prisma/adapter-better-sqlite3";
import bcrypt from "bcryptjs";
import path from "path";

const dbUrl = process.env.DATABASE_URL ?? "file:./dev.db";
// Match lib/prisma.ts resolution: file:./ → project_root/prisma/
const resolvedUrl = dbUrl.startsWith("file:./")
  ? `file:${path.resolve(process.cwd(), "prisma", dbUrl.slice(7))}`
  : dbUrl;
const adapter = new PrismaBetterSQLite3({ url: resolvedUrl });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter } as any);

const today = new Date();
const dateStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (n: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  return dateStr(d);
};

async function main() {
  // ── Get or create a user ────────────────────────────────────────────────────
  const targetUsername = process.argv[2] ?? null;
  let user = targetUsername
    ? await prisma.user.findUnique({ where: { username: targetUsername } })
    : await prisma.user.findFirst();

  if (!user) {
    console.log("No users found — creating demo user (username: demo, password: password123)");
    const passwordHash = await bcrypt.hash("password123", 12);
    const recoveryCodeHash = await bcrypt.hash("DEMO-RECOVERY-CODE", 12);
    user = await prisma.user.create({
      data: { username: "demo", passwordHash, recoveryCodeHash },
    });
  }

  console.log(`Seeding for user: ${user.username} (${user.id})`);

  // ── Guard: skip if already seeded ──────────────────────────────────────────
  const existingProjects = await prisma.project.count({ where: { userId: user.id } });
  if (existingProjects > 0) {
    console.log(`User already has ${existingProjects} projects — skipping seed.`);
    console.log("To re-seed, delete existing data first or pass --force.");
    return;
  }

  // ── Projects ────────────────────────────────────────────────────────────────
  const [personal, work, sideProject] = await Promise.all([
    prisma.project.create({ data: { name: "Personal", color: "#10b981", userId: user.id } }),
    prisma.project.create({ data: { name: "Work", color: "#3b82f6", userId: user.id } }),
    prisma.project.create({ data: { name: "Side Project", color: "#8b5cf6", userId: user.id } }),
  ]);
  console.log("✓ Projects created");

  // ── Tasks ───────────────────────────────────────────────────────────────────
  const tasksData = [
    // Personal — To Do
    { title: "Book dentist appointment", stage: "todo", priority: "medium", projectId: personal.id, position: 1000 },
    { title: "Renew car insurance", stage: "todo", priority: "high", projectId: personal.id, position: 2000 },
    { title: "Buy birthday gift for mom", stage: "todo", priority: "medium", projectId: personal.id, position: 3000 },
    // Personal — In Progress
    { title: "Read Atomic Habits", stage: "in_progress", priority: "low", projectId: personal.id, position: 1000 },
    { title: "30-day fitness challenge", stage: "in_progress", priority: "medium", projectId: personal.id, position: 2000 },
    // Personal — Done
    { title: "Set up emergency fund", stage: "done", priority: "high", projectId: personal.id, position: 1000 },
    { title: "Cancel unused subscriptions", stage: "done", priority: "low", projectId: personal.id, position: 2000 },

    // Work — To Do
    { title: "Prepare Q3 report slides", stage: "todo", priority: "high", projectId: work.id, position: 1000 },
    { title: "Schedule 1:1 with team leads", stage: "todo", priority: "medium", projectId: work.id, position: 2000 },
    { title: "Review open pull requests", stage: "todo", priority: "medium", projectId: work.id, position: 3000 },
    { title: "Update API documentation", stage: "todo", priority: "low", projectId: work.id, position: 4000 },
    // Work — In Progress
    { title: "Migrate auth service to JWT", stage: "in_progress", priority: "high", projectId: work.id, position: 1000 },
    { title: "Write integration tests for payments", stage: "in_progress", priority: "high", projectId: work.id, position: 2000 },
    { title: "Fix slow database queries", stage: "in_progress", priority: "medium", projectId: work.id, position: 3000 },
    // Work — Blocked
    { title: "Deploy to production", stage: "blocked", priority: "high", projectId: work.id, position: 1000 },
    { title: "Waiting on legal approval for new ToS", stage: "blocked", priority: "medium", projectId: work.id, position: 2000 },
    // Work — Done
    { title: "Set up CI/CD pipeline", stage: "done", priority: "high", projectId: work.id, position: 1000 },
    { title: "Onboard new engineer", stage: "done", priority: "medium", projectId: work.id, position: 2000 },
    { title: "Fix login redirect bug", stage: "done", priority: "high", projectId: work.id, position: 3000 },

    // Side Project — To Do
    { title: "Design landing page mockup", stage: "todo", priority: "medium", projectId: sideProject.id, position: 1000 },
    { title: "Write product copy", stage: "todo", priority: "low", projectId: sideProject.id, position: 2000 },
    { title: "Set up Stripe billing", stage: "todo", priority: "high", projectId: sideProject.id, position: 3000 },
    // Side Project — In Progress
    { title: "Build onboarding flow", stage: "in_progress", priority: "high", projectId: sideProject.id, position: 1000 },
    { title: "Implement email notifications", stage: "in_progress", priority: "medium", projectId: sideProject.id, position: 2000 },
    // Side Project — Done
    { title: "Register domain name", stage: "done", priority: "low", projectId: sideProject.id, position: 1000 },
    { title: "Pick tech stack", stage: "done", priority: "medium", projectId: sideProject.id, position: 2000 },
  ];

  await prisma.task.createMany({ data: tasksData });
  console.log(`✓ ${tasksData.length} tasks created`);

  // ── Notes ───────────────────────────────────────────────────────────────────
  const notesData = [
    {
      title: "Meeting notes — product sync",
      content: "<p>Discussed roadmap priorities for Q3. Key decisions:</p><ul><li>Ship mobile app by end of month</li><li>Defer analytics dashboard to Q4</li><li>Focus on performance improvements this sprint</li></ul>",
    },
    {
      title: "Book recommendations",
      content: "<p>Books to read this year:</p><ul><li><strong>Atomic Habits</strong> — James Clear</li><li><strong>Deep Work</strong> — Cal Newport</li><li><strong>The Mom Test</strong> — Rob Fitzpatrick</li><li><strong>Shape Up</strong> — Ryan Singer (free online)</li></ul>",
    },
    {
      title: "Workout routine",
      content: "<p><strong>Mon/Wed/Fri:</strong> Strength training (upper/lower split)</p><p><strong>Tue/Thu:</strong> 30 min cardio or yoga</p><p><strong>Weekend:</strong> Long walk or hike</p><p>Current goal: 4 workouts/week minimum.</p>",
    },
    {
      title: "Side project ideas",
      content: "<p>Ideas worth exploring:</p><ol><li>AI-powered meal planner that generates grocery lists</li><li>Habit tracker with streak sharing</li><li>Simple invoicing tool for freelancers</li><li>Focus timer with Spotify integration</li></ol>",
    },
    {
      title: "Weekly review template",
      content: "<h3>What went well?</h3><p>...</p><h3>What could be better?</h3><p>...</p><h3>Top 3 priorities for next week</h3><ol><li>...</li><li>...</li><li>...</li></ol>",
    },
  ];

  await prisma.note.createMany({
    data: notesData.map((n) => ({ ...n, userId: user!.id })),
  });
  console.log(`✓ ${notesData.length} notes created`);

  // ── Habits ──────────────────────────────────────────────────────────────────
  const habitsData = [
    { text: "Meditate 10 mins", position: 0 },
    { text: "Journal", position: 1 },
    { text: "Exercise", position: 2 },
    { text: "Read 20 pages", position: 3 },
    { text: "No phone before 9am", position: 4 },
  ];

  const habits = await Promise.all(
    habitsData.map((h) => prisma.habit.create({ data: { ...h, userId: user!.id } }))
  );

  // Mark first 3 habits as completed today
  await Promise.all(
    habits.slice(0, 3).map((h) =>
      prisma.habitCompletion.create({ data: { habitId: h.id, date: dateStr(today) } })
    )
  );
  console.log(`✓ ${habitsData.length} habits created (3 completed today)`);

  // ── Daily Goals (today) ─────────────────────────────────────────────────────
  const goalsData = [
    { text: "Finish auth migration PR", completed: true, position: 0 },
    { text: "Send Q3 report draft to manager", completed: false, position: 1 },
    { text: "30 min workout", completed: true, position: 2 },
  ];

  await prisma.dailyGoal.createMany({
    data: goalsData.map((g) => ({ ...g, date: dateStr(today), userId: user!.id })),
  });
  console.log(`✓ ${goalsData.length} daily goals created for today`);

  // ── Daily Reflections (past week) ───────────────────────────────────────────
  const reflections = [
    {
      date: daysAgo(1),
      note: "Follow up on the deploy blockers earlier in the day",
      gratitude: "Great pair programming session with the team",
      body: "Solid day overall. Shipped two features and unblocked the deploy issue. Energy was high in the morning but dipped after lunch — need to protect that afternoon focus block better.",
    },
    {
      date: daysAgo(2),
      note: "Plan tomorrow's work the night before instead of figuring it out in the morning",
      gratitude: "Sunny weather and a good run",
      body: "Felt scattered today. Too many context switches. Meetings ran long and I didn't get to deep work until 4pm. The run after work helped reset.",
    },
    {
      date: daysAgo(3),
      note: "Say no to more interruptions during focus blocks",
      gratitude: "Finally finished the chapter on habit stacking — the concept clicked",
      body: "Good progress on the onboarding flow. Got into a 2-hour flow state in the morning which felt great. Need to protect those windows better.",
    },
    {
      date: daysAgo(5),
      note: "Write down one win at the end of each day",
      gratitude: "Team appreciated the detailed PR review",
      body: "Quiet day. Mostly code review and documentation. Not glamorous but important. Finished the weekly review template which should help me be more intentional going forward.",
    },
    {
      date: daysAgo(7),
      note: "Set up a dedicated workspace without distractions",
      gratitude: "Good kickoff meeting — team is aligned on the roadmap",
      body: "Start of a new sprint. Kickoff went well, everyone seems energized. Set up my task board for the week and cleared out my backlog. Feeling ready.",
    },
  ];

  await prisma.dailyReflection.createMany({
    data: reflections.map((r) => ({ ...r, userId: user!.id })),
  });
  console.log(`✓ ${reflections.length} journal entries created`);

  console.log("\n🎉 Seed complete!");
  console.log(`   User: ${user.username}`);
  console.log(`   Projects: 3 | Tasks: ${tasksData.length} | Notes: ${notesData.length}`);
  console.log(`   Habits: ${habitsData.length} | Goals: ${goalsData.length} | Journal entries: ${reflections.length}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
