"use client";

import Link from "next/link";
import {
  ViewTransition,
  startTransition,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { Dictionary } from "@/i18n";
import { formatSum, type Locale } from "@/i18n/config";
import { track } from "@/lib/analytics/client";
import { DIRECTION_GOAL, quizBodyGoal } from "@/lib/body-goal";
import {
  ACTIVITIES,
  GOALS,
  largestLevelFarBelow,
  recommend,
  type Activity,
  type CalculatorProgram,
  type Goal,
  type NumericField,
  type Sex,
} from "@/lib/calculator";
import { useCountUp } from "@/lib/use-count-up";
import { NumberField, useNumberFields } from "../calculator/fields";

type Props = {
  locale: Locale;
  t: Dictionary["quiz"];
  c: Dictionary["calculator"];
  /** The calculator's note for a norm far above the largest ration (bodyGoal.aboveLargest: {gap} and {max} in kcal). */
  aboveLargest: string;
  programs: CalculatorProgram[];
  telegramUrl: string;
};

/** Questions, then the result (step 3). */
const QUESTIONS = 3;
type Step = 0 | 1 | 2 | 3;

/**
 * Each step after the first has a history entry of its own (pushState), so the browser's Back goes to the
 * previous question instead of leaving the page. No element has these ids, so the browser never scrolls to them.
 */
const HASH: Record<Step, string> = { 0: "", 1: "#step-2", 2: "#step-3", 3: "#result" };
const stepFromHash = (hash: string): Step =>
  (([1, 2, 3] as const).find((step) => HASH[step] === hash) ?? 0) as Step;

const BODY_FIELDS: readonly NumericField[] = ["age", "height", "weight"];

/**
 * The program finder: goal, activity, then sex / age / height / weight on one screen, then the result from the
 * calculator's own maths (quizBodyGoal in src/lib/body-goal.ts) and its recommendation (src/lib/calculator.ts). Answers
 * live in component state; the step lives in the URL hash. A reload starts over (the answers are gone), so a hash on arrival is dropped.
 */
export function Quiz({ locale, t, c, aboveLargest, programs, telegramUrl }: Props) {
  const [requested, setRequested] = useState<Step>(0);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [sex, setSex] = useState<Sex | null>(null);
  const fields = useNumberFields(BODY_FIELDS);

  const { age, height, weight } = fields.parsed;
  const bodyDone = sex !== null && age !== null && height !== null && weight !== null;
  // A step can only show once every earlier question is answered (Back / Forward through history, restart).
  const reachable: Step = !goal ? 0 : !activity ? 1 : !bodyDone ? 2 : 3;
  const step = Math.min(requested, reachable) as Step;
  const answered = [goal !== null, activity !== null, bodyDone][step] ?? false;

  // The calculator's maths (src/lib/body-goal.ts, quizBodyGoal): average muscularity and a goal weight from the
  // answer, so the quiz and /calculator give the same calories, macros and program for the same person.
  const result =
    goal && activity && bodyDone
      ? quizBodyGoal({ sex: sex!, age: age!, height: height!, weight: weight!, activity, goal })
      : null;
  const plan = result ? recommend(programs, result.kcal, DIRECTION_GOAL[result.direction]) : null;
  // As on the calculator: a norm 1,000+ kcal above the largest ration says so instead of "the closest level".
  const largestFar = plan && result ? largestLevelFarBelow(programs, result.kcal) : null;
  const largestNote =
    result && largestFar !== null
      ? aboveLargest.replaceAll("{gap}", formatSum(result.kcal - largestFar)).replaceAll("{max}", formatSum(largestFar))
      : null;
  const shownKcal = useCountUp(step === 3 && result ? result.kcal : null);

  const section = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  function show(next: Step) {
    // A long step scrolled under the header: bring the quiz's top back before the next question fades in.
    const el = section.current;
    if (el && el.getBoundingClientRect().top < 64) el.scrollIntoView({ block: "start", behavior: "instant" });
    moved.current = true;
    startTransition(() => setRequested(next));
  }

  useEffect(() => {
    // Arriving on #step-3 after a reload: the answers are gone, so start at the first question.
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    const onPopState = () => show(stepFromHash(location.hash));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Analytics: the answers last sent as quiz_completed, so Back and Next to the same result do not count twice.
  const completed = useRef("");

  // After a step change (never on arrival), keyboard and screen-reader users land on the new question.
  useEffect(() => {
    if (moved.current) heading.current?.focus({ preventScroll: true });
  }, [step]);

  function advance() {
    if (!answered || step === 3) return;
    const next = (step + 1) as Step;
    // Analytics: sent from the Next that opens the result, never from the browser's Back / Forward through the steps
    // or a kept page shown again. Once per set of answers; the goal and the matched program only.
    const answers = JSON.stringify([goal, activity, sex, age, height, weight]);
    if (next === 3 && goal && completed.current !== answers) {
      completed.current = answers;
      track("quiz_completed", { goal, program: plan?.program.slug ?? "none", locale });
    }
    history.pushState(null, "", location.pathname + location.search + HASH[next]);
    show(next);
  }

  function restart() {
    const back = step;
    completed.current = "";
    setGoal(null);
    setActivity(null);
    setSex(null);
    for (const field of BODY_FIELDS) fields.set(field, "");
    // Back to the first entry, so history holds no stale steps; the popstate shows question one.
    if (back > 0) history.go(-back);
  }

  const macros = result
    ? ([
        [c.protein, result.protein, (result.protein * 4) / result.kcal],
        [c.fat, result.fat, (result.fat * 9) / result.kcal],
        [c.carbs, result.carbs, (result.carbs * 4) / result.kcal],
      ] as const)
    : [];
  const announcement =
    step === 3 && result
      ? [
          `${c.resultLabel}: ${formatSum(result.kcal)} ${c.kcal}.`,
          macros.map(([term, grams]) => `${term} ${grams} ${c.grams}`).join(", ") + ".",
          plan ? `${c.planLabel}: ${plan.program.name} ${plan.variant.kcal}.` : c.noPlan,
          largestNote ?? "",
        ]
          .filter(Boolean)
          .join(" ")
      : "";

  const orderHref = plan ? `/${locale}/order?program=${plan.program.slug}&kcal=${plan.variant.kcal}` : null;
  const headingClass = "font-serif text-3xl leading-tight text-forest focus:outline-none md:text-4xl";

  let content: ReactNode;
  if (step === 0) {
    content = (
      <fieldset>
        <legend>
          <h2 ref={heading} tabIndex={-1} className={headingClass}>
            {t.goal}
          </h2>
        </legend>
        <div className="mt-6 grid gap-3">
          {GOALS.map((value) => (
            <Choice
              key={value}
              name="goal"
              checked={goal === value}
              onChange={() => setGoal(value)}
              title={c.goals[value].title}
              hint={c.goals[value].hint}
            />
          ))}
        </div>
      </fieldset>
    );
  } else if (step === 1) {
    content = (
      <fieldset>
        <legend>
          <h2 ref={heading} tabIndex={-1} className={headingClass}>
            {t.activity}
          </h2>
        </legend>
        <div className="mt-6 grid gap-3">
          {ACTIVITIES.map((value) => (
            <Choice
              key={value}
              name="activity"
              checked={activity === value}
              onChange={() => setActivity(value)}
              title={c.activities[value].title}
              hint={c.activities[value].hint}
            />
          ))}
        </div>
      </fieldset>
    );
  } else if (step === 2) {
    const labels: Record<NumericField, { label: string; unit: string }> = {
      age: { label: c.age, unit: c.ageUnit },
      height: { label: c.height, unit: c.heightUnit },
      weight: { label: c.weight, unit: c.weightUnit },
    };
    content = (
      <div>
        <h2 ref={heading} tabIndex={-1} className={headingClass}>
          {t.body}
        </h2>
        <p className="mt-2 text-muted">{t.bodyHint}</p>
        <fieldset className="mt-6">
          <legend className="label text-muted">{c.sex}</legend>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {(
              [
                ["female", c.female],
                ["male", c.male],
              ] as const
            ).map(([value, title]) => (
              <Choice key={value} name="sex" checked={sex === value} onChange={() => setSex(value)} title={title} />
            ))}
          </div>
        </fieldset>
        <div className="mt-6 grid grid-cols-3 gap-3">
          {BODY_FIELDS.map((field) => (
            <NumberField
              key={field}
              id={`quiz-${field}`}
              field={field}
              label={labels[field].label}
              unit={labels[field].unit}
              value={fields.values[field]}
              invalid={fields.showError(field)}
              rangeError={c.rangeError}
              onChange={(raw) => fields.set(field, raw)}
              onBlur={() => fields.blur(field)}
            />
          ))}
        </div>
      </div>
    );
  } else {
    content = result && (
      <div className="rounded-3xl bg-forest p-6 text-ivory md:p-8">
        {plan ? (
          <>
            <h2 ref={heading} tabIndex={-1} className="label text-gold focus:outline-none">
              {c.planLabel}
            </h2>
            <span className="mt-4 block h-1 w-8 rounded-full" style={{ background: plan.program.tagColor }} aria-hidden />
            <p className="mt-3 font-serif text-4xl leading-tight md:text-5xl">
              {plan.program.name} <span className="text-gold">/ {plan.variant.kcal}</span>
            </p>
            <p className="mt-2 text-sm text-ivory/70">
              {c.from} <span className="font-semibold text-ivory tabular-nums">{formatSum(plan.variant.fromPrice)}</span>{" "}
              {c.perDay}
            </p>
            {largestNote ? (
              <p className="mt-3 text-sm leading-relaxed text-ivory/85">{largestNote}</p>
            ) : (
              <p className="mt-3 text-xs leading-relaxed text-ivory/60">{c.planNote}</p>
            )}
          </>
        ) : (
          <>
            <h2 ref={heading} tabIndex={-1} className="label text-gold focus:outline-none">
              {t.resultTitle}
            </h2>
            <p className="mt-3 leading-relaxed text-ivory/80">{c.noPlan}</p>
          </>
        )}

        <div className="mt-6 border-t border-ivory/15 pt-5">
          <p className="label text-gold">{t.kcalLabel}</p>
          <p className="mt-3 font-serif text-5xl tabular-nums" aria-hidden>
            {formatSum(shownKcal)} <span className="font-sans text-lg text-ivory/70">{c.kcal}</span>
          </p>
          <dl className="mt-5 grid grid-cols-3 gap-3" aria-hidden>
            {macros.map(([term, grams, ratio]) => (
              <div key={term}>
                <dt className="text-xs text-ivory/60">{term}</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">
                  {grams} <span className="text-sm font-normal text-ivory/70">{c.grams}</span>
                </dd>
                <dd className="mt-2 h-1 overflow-hidden rounded-full bg-ivory/15">
                  <span
                    className="grow-x grow-live block h-full rounded-full bg-gold"
                    style={{ "--bar": Math.min(ratio, 1).toFixed(3) } as CSSProperties}
                  />
                </dd>
              </div>
            ))}
          </dl>
          {result.floored && (
            <p className="mt-4 text-sm leading-relaxed text-ivory/75">{c.floored.replace("{min}", String(result.kcalFloor))}</p>
          )}
        </div>

        <div className="mt-6 grid gap-3 border-t border-ivory/15 pt-5 sm:grid-cols-2">
          {plan && (
            <Link
              href={`/${locale}/menu?program=${plan.program.slug}&kcal=${plan.variant.kcal}`}
              className="btn btn-outline text-ivory"
            >
              {c.menu}
            </Link>
          )}
          <a href={telegramUrl} className="btn btn-outline text-ivory" rel="noopener">
            {c.telegram}
          </a>
        </div>
        <p className="mt-5 text-xs leading-relaxed text-ivory/60">{t.note}</p>
        <button
          type="button"
          onClick={restart}
          className="press mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-gold underline-offset-4 hover:underline"
        >
          {t.restart}
        </button>
      </div>
    );
  }

  return (
    // Phones: at least a screen tall (under the 56 px header), so the pinned bar sits at the bottom of the screen
    // whenever the quiz is in view, and never over the footer. From md it is a centred column.
    <section
      ref={section}
      aria-label={t.short}
      className="container-page flex scroll-mt-14 flex-col pt-6 max-md:min-h-[calc(100dvh-3.5rem)] md:max-w-2xl md:pt-12 lg:scroll-mt-16"
    >
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      <div>
        <p className="label text-muted tabular-nums">
          {step < 3 ? t.step.replace("{n}", String(step + 1)).replace("{total}", String(QUESTIONS)) : t.resultTitle}
        </p>
        <div aria-hidden className="mt-2 h-1 overflow-hidden rounded-full bg-ivory-deep">
          <span
            className="block h-full origin-left rounded-full bg-gold transition-[scale] duration-[var(--duration-slow)] ease-out-calm"
            style={{ scale: `${Math.min(step + 1, QUESTIONS) / QUESTIONS} 1` }}
          />
        </div>
      </div>

      <form
        className="flex flex-1 flex-col"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          advance();
        }}
      >
        {/* Same place, the next question: the old one fades out, the new one fades in and rises 12 px. */}
        <ViewTransition key={step} name="quiz-step" share="quiz-step" default="none">
          <div className="pb-8 pt-6 md:pt-8">{content}</div>
        </ViewTransition>

        <div className="sticky bottom-0 z-20 -mx-5 mt-auto border-t border-line bg-ivory px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 md:mx-0 md:border-0 md:px-0 md:pb-12">
          <div className="flex gap-3">
            {step > 0 && (
              // Phones: an arrow-only circle (the word stays for screen readers), so the main button keeps its width.
              <button
                type="button"
                onClick={() => history.back()}
                className="btn btn-outline min-h-12 shrink-0 text-forest max-sm:size-12 max-sm:!p-0"
              >
                <span aria-hidden>←</span>
                <span className="max-sm:sr-only">{t.back}</span>
              </button>
            )}
            {step < 3 ? (
              <button
                type="submit"
                disabled={!answered}
                className="btn btn-forest min-h-12 flex-1 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {step === 2 ? t.showResult : t.next}
              </button>
            ) : orderHref ? (
              <Link href={orderHref} className="btn btn-gold min-h-12 flex-1">
                {c.order}
              </Link>
            ) : (
              <a href={telegramUrl} className="btn btn-gold min-h-12 flex-1" rel="noopener">
                {c.telegram}
              </a>
            )}
          </div>
        </div>
      </form>
    </section>
  );
}

/** One answer: a ≥ 56 px row, the radio visually hidden inside (press feedback from globals.css). */
function Choice({
  name,
  checked,
  onChange,
  title,
  hint,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  hint?: string;
}) {
  return (
    <label className="relative block cursor-pointer">
      <input type="radio" name={name} checked={checked} onChange={onChange} className="peer sr-only" />
      <span
        className={`flex min-h-14 items-center justify-between gap-4 rounded-2xl border px-4 py-3 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-(color:--focus-ring) ${
          checked ? "border-forest bg-forest text-ivory" : "border-line bg-white text-forest hover:border-forest"
        }`}
      >
        <span className="min-w-0">
          <span className="block font-semibold">{title}</span>
          {hint && <span className="mt-0.5 block text-sm opacity-75">{hint}</span>}
        </span>
        <span
          aria-hidden
          className={`flex size-6 shrink-0 items-center justify-center rounded-full border ${
            checked ? "border-gold bg-gold text-forest" : "border-line"
          }`}
        >
          {checked && (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2.5 6.2l2.3 2.3 4.7-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
      </span>
    </label>
  );
}
