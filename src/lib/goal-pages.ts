/**
 * Goal landing pages (/[locale]/goals/[goal]): one template, the copy per goal in the dictionaries
 * (t.goals.pages[goal]). The slug is shared by every language, so hreflang pairs the pages one to one;
 * the search words live in the title, h1 and copy.
 *
 * Pure data with no imports: the phone call-to-action bar (a client component) reads GOAL_PROGRAM too.
 */

export const GOAL_PAGES = ["weight-loss", "high-protein", "balanced", "halal"] as const;
export type GoalPage = (typeof GOAL_PAGES)[number];

export function isGoalPage(value: string): value is GoalPage {
  return (GOAL_PAGES as readonly string[]).includes(value);
}

/**
 * The program each goal sells, by catalogue slug. null: the goal is true of every program (halal), so the
 * page lists them all. A slug the catalogue no longer has also falls back to all programs.
 */
export const GOAL_PROGRAM: Record<GoalPage, string | null> = {
  "weight-loss": "light",
  "high-protein": "protein",
  balanced: "balance",
  halal: null,
};

/**
 * Questions from the site FAQ (t.faq.items, by id) shown on each goal page after its own questions.
 * The goal pages state no FAQPage data: /faq owns these questions.
 */
export const GOAL_SHARED_FAQ: Record<GoalPage, readonly string[]> = {
  "weight-loss": ["when", "pause"],
  "high-protein": ["kcal", "when", "pause"],
  balanced: ["kcal", "when", "pause"],
  halal: ["halal", "when", "pause"],
};

/** The programs a goal page shows: its own program, or every program when it has none in the catalogue. */
export function goalPrograms<P extends { slug: string }>(programs: P[], goal: GoalPage): P[] {
  const slug = GOAL_PROGRAM[goal];
  const own = slug ? programs.filter((p) => p.slug === slug) : [];
  return own.length > 0 ? own : programs;
}

/** The goal pages a program page links to: the goals that sell it, and the goals true of every program. */
export function goalsForProgram(slug: string): GoalPage[] {
  return GOAL_PAGES.filter((goal) => GOAL_PROGRAM[goal] === slug || GOAL_PROGRAM[goal] === null);
}
