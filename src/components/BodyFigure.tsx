"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Sex } from "@/lib/calculator";
import type { Muscularity } from "@/lib/body-goal";

/**
 * The body goal calculator's figure (docs/plans/body-goal-calculator.md §0): one original, parametric SVG body
 * per side ("now" and "goal") that morphs live with the sliders. Front view, clothed in a sports top, shorts and
 * trainers, in brand colours only.
 *
 * - Widths (neck, shoulders, chest, waist, hips, thighs, knees, calves, arms) come from body fat and
 *   muscularity; the whole figure scales with height inside a fixed frame (220 cm fills it), so 150 cm stands
 *   visibly shorter than 200 cm. Faint lines mark 150, 175 and 200 cm.
 * - Outlines are Catmull-Rom curves through landmark points, turned into cubic béziers.
 * - Body fat, muscularity and height tween with requestAnimationFrame (250 ms, ease-out), not CSS `d`
 *   transitions (Safari cannot animate `d`). With prefers-reduced-motion the new shape shows at once. A change
 *   of sex swaps the base without a tween.
 *
 * Decorative: aria-hidden. The page states the same facts in text next to it.
 */

type Point = readonly [number, number];

/** Muscularity steps as a 0–1 amount of muscle for the drawing. */
const MUSCLE: Record<Muscularity, number> = { low: 0, average: 0.35, athletic: 0.7, muscular: 1 };

/** The canonical figure is FIGURE_UNITS tall at FRAME_CM; shorter people are scaled down from it. */
const FRAME_CM = 220;
const FIGURE_UNITS = 400;
const GROUND_Y = 402;
/** The frame: just wider than the widest figure; the ruler lines run on past it (overflow visible). */
const VIEW = { x: -65, y: -4, width: 130, height: 412 } as const;
const RULER_CM = [150, 175, 200] as const;
const TWEEN_MS = 250;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const f = (n: number) => (Math.round(n * 100) / 100).toString();

/* ---------------------------------------------------------------------------------------
   Curves
   --------------------------------------------------------------------------------------- */

/** Cubic segments ("C …") through the points, starting from points[0] (uniform Catmull-Rom). */
function curveThrough(points: readonly Point[], closed = false): string {
  const n = points.length;
  const at = (i: number): Point => {
    if (closed) return points[(i + n) % n];
    return points[Math.min(Math.max(i, 0), n - 1)];
  };
  let d = "";
  const segments = closed ? n : n - 1;
  for (let i = 0; i < segments; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1: Point = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Point = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

const move = (p: Point) => `M${f(p[0])} ${f(p[1])}`;
const line = (p: Point) => ` L${f(p[0])} ${f(p[1])}`;

/** A closed smooth outline through the points. */
function closedPath(points: readonly Point[]): string {
  return `${move(points[0])}${curveThrough(points, true)} Z`;
}

/** Two smooth edges joined by straight lines at both ends (a leg, a sleeve). */
function ribbon(edgeA: readonly Point[], edgeB: readonly Point[]): string {
  const back = [...edgeB].reverse();
  return `${move(edgeA[0])}${curveThrough(edgeA)}${line(back[0])}${curveThrough(back)} Z`;
}

/** The right half's points mirrored to the left (x → −x), in reverse order, so right + left goes round. */
const mirror = (points: readonly Point[]): Point[] => [...points].reverse().map(([x, y]) => [-x, y] as Point);
const flip = (points: readonly Point[]): Point[] => points.map(([x, y]) => [-x, y] as Point);

/** x on a piecewise-linear edge at height y. */
function edgeAt(points: readonly Point[], y: number): number {
  if (y <= points[0][1]) return points[0][0];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x0, y0] = points[i - 1];
    if (y <= y1) return lerp(x0, x1, (y - y0) / (y1 - y0 || 1));
  }
  return points[points.length - 1][0];
}

/* ---------------------------------------------------------------------------------------
   Shape: half-widths in figure units (the canonical figure is 400 units tall)
   --------------------------------------------------------------------------------------- */

type Shape = {
  sex: Sex;
  /** 0–1: muscle; and the fat amount, about −0.5 (very lean) to 1.6 (very heavy). */
  muscle: number;
  fat: number;
  headRx: number;
  neck: number;
  shoulder: number;
  chest: number;
  waist: number;
  belly: number;
  hip: number;
  thigh: number;
  knee: number;
  calf: number;
  ankle: number;
  upperArm: number;
  forearm: number;
  deltoid: number;
};

/** Body fat (%) at which a figure is drawn "slim" (fat amount 0), and the points per +1 of fat amount. */
const FAT_ZERO: Record<Sex, number> = { male: 13, female: 23 };
const FAT_SPAN = 15;

function shapeOf(sex: Sex, bodyFat: number, muscle: number): Shape {
  const raw = (bodyFat - FAT_ZERO[sex]) / FAT_SPAN;
  const fat = Math.min(Math.max(raw, -0.6), 1.7);
  // Leaner than "slim" narrows the body more gently than fat widens it.
  const a = fat < 0 ? fat * 0.7 : fat;
  const m = muscle;
  // Muscle reads first in the shoulders, chest, arms, thighs and calves, hardly at the waist (a V-taper). Fat
  // widens the waist, belly and hips most.
  if (sex === "male") {
    const waist = 24.5 + 1.5 * m + 12.5 * a;
    return {
      sex,
      muscle: m,
      fat,
      headRx: 16.2 + 1.1 * Math.max(a, 0),
      neck: 7.8 + 4.2 * m + 2 * a,
      shoulder: 36.5 + 14 * m + 2.4 * a,
      chest: 30.5 + 9 * m + 6 * a,
      waist,
      belly: waist + 2.6 * Math.max(a, 0),
      hip: 29 + 1.5 * m + 7.5 * a,
      thigh: 11.4 + 5.5 * m + 5.4 * a,
      knee: 7.4 + 1.2 * m + 1.5 * a,
      calf: 8.1 + 3.6 * m + 2.3 * a,
      ankle: 4.7 + 0.4 * m + 0.5 * Math.max(a, 0),
      upperArm: 5.8 + 5.9 * m + 2.4 * a,
      forearm: 5.2 + 2.8 * m + 1.2 * a,
      deltoid: 6.9 + 8 * m + 2.2 * a,
    };
  }
  // Women: the same idea, scaled down (toned, not bulky).
  const waist = 20.5 + 0.6 * m + 11 * a;
  return {
    sex,
    muscle: m,
    fat,
    headRx: 15.2 + 0.9 * Math.max(a, 0),
    neck: 6.2 + 1.6 * m + 1.6 * a,
    shoulder: 30 + 7 * m + 2.2 * a,
    chest: 27.5 + 3 * m + 7.5 * a,
    waist,
    belly: waist + 1.6 * Math.max(a, 0),
    hip: 32.5 + 2.5 * m + 10.5 * a,
    thigh: 13.2 + 3.4 * m + 6 * a,
    knee: 7.4 + 1 * m + 1.8 * a,
    calf: 8 + 2.6 * m + 2.1 * a,
    ankle: 4.4 + 0.3 * m + 0.5 * Math.max(a, 0),
    upperArm: 5.3 + 3.2 * m + 3 * a,
    forearm: 4.6 + 1.4 * m + 1.2 * a,
    deltoid: 5.8 + 4.2 * m + 2.4 * a,
  };
}

/* ---------------------------------------------------------------------------------------
   Parts (right half; mirrored for the left)
   --------------------------------------------------------------------------------------- */

type Parts = {
  head: string;
  hair: string;
  ears: string;
  neck: string;
  torso: string;
  legs: string;
  shoes: string;
  soles: string;
  arms: string;
  hands: string;
  top: string;
  sleeves: string;
  shorts: string;
  accents: string;
  /** Soft detail lines: muscle (on the top's chest, on the legs) and fat, with their own opacity. */
  chestLines: string;
  legLines: string;
  muscleOpacity: number;
  fatLines: string;
  fatOpacity: number;
  /** Half-width of the ground shadow. */
  footprint: number;
};

function buildParts(s: Shape): Parts {
  const male = s.sex === "male";
  const a = Math.max(s.fat, 0);

  // Landmark heights (figure units, 0 = top of the head, 400 = soles).
  const Y = male
    ? { chin: 50, neckBase: 64, trap: 69, shoulder: 77, armpit: 103, chest: 115, rib: 138, waist: 160, belly: 178, hip: 201, crotch: 222, hem: 213, shortsHem: 258 }
    : { chin: 49, neckBase: 63, trap: 68, shoulder: 75, armpit: 99, chest: 113, rib: 129, waist: 152, belly: 178, hip: 207, crotch: 222, hem: 196, shortsHem: 264 };
  const KNEE_Y = 292;
  const CALF_Y = 322;
  const ANKLE_Y = 380;

  /* Torso: neck base → shoulders → chest → waist → hips, right side. */
  const torsoRight: Point[] = [
    [s.neck * 1.06, Y.neckBase - 2],
    [lerp(s.neck, s.shoulder, 0.5), Y.trap],
    [s.shoulder - 3.5, Y.shoulder],
    [s.shoulder - 2, Y.shoulder + 10],
    [Math.max(s.chest + 1.5, s.shoulder - 6), Y.armpit],
    [s.chest, Y.chest],
    [lerp(s.chest, s.waist, male ? 0.48 : 0.58), Y.rib],
    [s.waist, Y.waist],
    [male ? s.belly : lerp(s.waist, s.hip, 0.62) + (s.belly - s.waist), Y.belly],
    [s.hip, Y.hip],
    [s.hip - 1.2, Y.crotch - 6],
  ];
  const torso = closedPath([...torsoRight, [s.hip * 0.55, Y.crotch + 2], [0, Y.crotch + 4], [-s.hip * 0.55, Y.crotch + 2], ...mirror(torsoRight)]);

  /* Legs. The thighs fill the hips; the gap between them closes as they widen. */
  const legTop = Y.hip + 8;
  const innerTop = Math.max(0.7, s.hip - 2 * s.thigh);
  const cxTop = (s.hip + innerTop) / 2;
  const hwTop = (s.hip - innerTop) / 2;
  const cxKnee = (male ? 12.5 : 11) + 0.22 * Math.max(s.hip - 30, 0) + 0.15 * s.thigh;
  const legStations: { y: number; cx: number; outer: number; inner: number }[] = [
    { y: legTop, cx: cxTop, outer: hwTop, inner: hwTop },
    { y: 240, cx: lerp(cxTop, cxKnee, 0.32), outer: s.thigh * 0.95, inner: s.thigh * 0.9 },
    { y: 268, cx: lerp(cxTop, cxKnee, 0.7), outer: lerp(s.thigh * 0.88, s.knee, 0.45), inner: lerp(s.thigh * 0.8, s.knee, 0.5) },
    { y: KNEE_Y, cx: cxKnee, outer: s.knee, inner: s.knee * 0.98 },
    { y: CALF_Y, cx: cxKnee + 0.6, outer: s.calf * 0.98, inner: s.calf * 1.04 },
    { y: 352, cx: cxKnee + 1.2, outer: lerp(s.calf, s.ankle, 0.55), inner: lerp(s.calf, s.ankle, 0.6) },
    { y: ANKLE_Y + 4, cx: cxKnee + 1.6, outer: s.ankle, inner: s.ankle },
  ];
  const legOuter: Point[] = legStations.map((p) => [p.cx + p.outer, p.y]);
  const legInner: Point[] = legStations.map((p) => [p.cx - p.inner, p.y]);
  const leg = (sign: 1 | -1) => {
    const o = sign === 1 ? legOuter : flip(legOuter);
    const i = sign === 1 ? legInner : flip(legInner);
    // Start a little above the hip line, under the torso.
    return ribbon([[o[0][0], o[0][1] - 10], ...o], [[i[0][0], i[0][1] - 14], ...i]);
  };
  const legs = `${leg(1)} ${leg(-1)}`;

  /* Trainers: a dome over each foot, toes turned slightly out; an ivory sole. */
  const ankleCx = cxKnee + 1.6;
  const shoeW = (male ? 8.6 : 7.4) + 0.4 * a;
  const shoe = (sign: 1 | -1) => {
    const cx = sign * (ankleCx + 0.8);
    const top = ANKLE_Y - 1;
    return `${move([cx - shoeW, 399])}${line([cx - shoeW, 392])} C${f(cx - shoeW)} ${f(top + 4)} ${f(cx - shoeW * 0.55)} ${f(top)} ${f(cx)} ${f(top)} C${f(cx + shoeW * 0.55)} ${f(top)} ${f(cx + shoeW + 0.6 * sign)} ${f(top + 4)} ${f(cx + shoeW + 0.6 * sign)} ${f(392)}${line([cx + shoeW + 0.6 * sign, 399])} Z`;
  };
  const shoes = `${shoe(1)} ${shoe(-1)}`;
  const sole = (sign: 1 | -1) => {
    const cx = sign * (ankleCx + 0.8);
    return `${move([cx - shoeW - 0.4, 396])}${line([cx + shoeW + 1, 396])}${line([cx + shoeW + 1, 400])}${line([cx - shoeW - 0.4, 400])} Z`;
  };
  const soles = `${sole(1)} ${sole(-1)}`;

  /* Arms: hang from the shoulder joint, angled out just enough to clear the waist, belly and hips. */
  const joint: Point = [s.shoulder - s.deltoid * 0.55, Y.shoulder + 8];
  const widest = Math.max(s.waist, s.belly, s.hip);
  const wristY = male ? 214 : 208;
  const elbowY = male ? 152 : 148;
  const wristX = Math.max(joint[0] + 3, widest + s.forearm * 0.85 + 2);
  // The elbow clears the waist and, on a broad back, the flare of the lats below the armpit.
  const ribX = lerp(s.chest, s.waist, male ? 0.48 : 0.58);
  const elbowX = Math.max(lerp(joint[0], wristX, 0.45) + 1.2, Math.max(s.waist, ribX - 2) + s.upperArm * 0.75 + 1.5);
  const elbow: Point = [elbowX, elbowY];
  const wrist: Point = [wristX, wristY];
  // Width profile along the arm: t from the shoulder (0) to the wrist (1).
  const armProfile: { t: number; w: number }[] = [
    { t: 0, w: s.deltoid },
    { t: 0.1, w: s.deltoid * 0.94 },
    { t: 0.22, w: lerp(s.deltoid * 0.8, s.upperArm, 0.6) },
    { t: 0.32, w: s.upperArm },
    { t: 0.44, w: s.upperArm * 0.86 },
    { t: 0.52, w: lerp(s.upperArm * 0.74, s.forearm, 0.5) },
    { t: 0.62, w: s.forearm },
    { t: 0.8, w: s.forearm * 0.82 },
    { t: 1, w: s.forearm * 0.64 },
  ];
  const armAt = (t: number): { p: Point; n: Point } => {
    const [from, to, u] = t <= 0.5 ? [joint, elbow, t / 0.5] : [elbow, wrist, (t - 0.5) / 0.5];
    const p: Point = [lerp(from[0], to[0], u), lerp(from[1], to[1], u)];
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const len = Math.hypot(dx, dy) || 1;
    // Normal pointing away from the body (to the right for the right arm).
    return { p, n: [dy / len, -dx / len] };
  };
  const armEdges = (pad: number, upTo = 1) => {
    const outer: Point[] = [];
    const inner: Point[] = [];
    for (const { t, w } of armProfile) {
      if (t > upTo + 1e-6) break;
      const { p, n } = armAt(t);
      outer.push([p[0] + n[0] * (w + pad), p[1] + n[1] * (w + pad)]);
      inner.push([p[0] - n[0] * (w + pad) * 0.92, p[1] - n[1] * (w + pad) * 0.92]);
    }
    if (upTo < 1) {
      const { p, n } = armAt(upTo);
      const w = lerp(s.deltoid * 0.8, s.upperArm, 0.6) + pad;
      outer.push([p[0] + n[0] * w, p[1] + n[1] * w]);
      inner.push([p[0] - n[0] * w * 0.92, p[1] - n[1] * w * 0.92]);
    }
    return { outer, inner };
  };
  const cap: Point = [joint[0] + s.deltoid * 0.2, joint[1] - s.deltoid * 0.8];
  const capIn: Point = [joint[0] - s.deltoid * 0.75, joint[1] - s.deltoid * 0.55];
  const armPath = (sign: 1 | -1) => {
    const { outer, inner } = armEdges(0);
    const o: Point[] = [capIn, cap, ...outer];
    return ribbon(sign === 1 ? o : flip(o), sign === 1 ? inner : flip(inner));
  };
  const arms = `${armPath(1)} ${armPath(-1)}`;

  /* Hands: a rounded mitten along the forearm's line. */
  const hand = (sign: 1 | -1) => {
    const dir: Point = [wrist[0] - elbow[0], wrist[1] - elbow[1]];
    const len = Math.hypot(dir[0], dir[1]) || 1;
    const u: Point = [dir[0] / len, dir[1] / len];
    const n: Point = [u[1], -u[0]];
    const w = s.forearm * 0.74 + 0.5;
    const L = male ? 20 : 17.5;
    const at = (along: number, across: number): Point => [
      sign * (wrist[0] + u[0] * along + n[0] * across),
      wrist[1] + u[1] * along + n[1] * across,
    ];
    return closedPath([at(-2, w * 0.92), at(L * 0.42, w * 1.08), at(L * 0.82, w * 0.72), at(L, -w * 0.1), at(L * 0.86, -w * 0.78), at(L * 0.4, -w * 1.02), at(-2, -w * 0.92)]);
  };
  const hands = `${hand(1)} ${hand(-1)}`;

  /* Head, ears, neck, hair. */
  const rx = s.headRx;
  const headRight: Point[] = [
    [rx * 0.62, 2],
    [rx * 0.98, 16],
    [rx * 0.94, 32],
    [rx * (0.72 + 0.05 * a), 44],
    [rx * 0.3, Y.chin],
  ];
  const head = closedPath([[0, 0], ...headRight, [0, Y.chin + 0.6], ...mirror(headRight)]);
  const ear = (sign: 1 | -1) => closedPath([[sign * (rx - 1), 22], [sign * (rx + 2.6), 24], [sign * (rx + 2.4), 32], [sign * (rx - 1), 35]]);
  const ears = `${ear(1)} ${ear(-1)}`;
  const nw = s.neck;
  const neck = `${move([-nw, 40])}${line([nw, 40])}${curveThrough([[nw, 40], [nw * 1.02, Y.chin + 6], [nw * 1.25, Y.neckBase + 3]])}${line([-nw * 1.25, Y.neckBase + 3])}${curveThrough([[-nw * 1.25, Y.neckBase + 3], [-nw * 1.02, Y.chin + 6], [-nw, 40]])} Z`;
  const hair = male
    ? `${move([-rx - 0.6, 25])} C${f(-rx - 1.6)} ${f(6)} ${f(-rx * 0.62)} ${f(-3)} ${f(0)} ${f(-3)} C${f(rx * 0.62)} ${f(-3)} ${f(rx + 1.6)} ${f(6)} ${f(rx + 0.6)} ${f(25)} C${f(rx * 0.92)} ${f(19)} ${f(rx * 0.9)} ${f(12)} ${f(rx * 0.55)} ${f(9.5)} C${f(rx * 0.25)} ${f(8)} ${f(-rx * 0.25)} ${f(8)} ${f(-rx * 0.55)} ${f(9.5)} C${f(-rx * 0.9)} ${f(12)} ${f(-rx * 0.92)} ${f(19)} ${f(-rx - 0.6)} ${f(25)} Z`
    : `${move([-rx - 2.6, 40])} C${f(-rx - 4)} ${f(8)} ${f(-rx * 0.7)} ${f(-3.5)} ${f(0)} ${f(-3.5)} C${f(rx * 0.7)} ${f(-3.5)} ${f(rx + 4)} ${f(8)} ${f(rx + 2.6)} ${f(40)} C${f(rx + 1)} ${f(41)} ${f(rx * 0.92)} ${f(36)} ${f(rx * 0.96)} ${f(24)} C${f(rx * 0.9)} ${f(14)} ${f(rx * 0.5)} ${f(9)} ${f(1)} ${f(8)} L${f(-1)} ${f(8)} C${f(-rx * 0.5)} ${f(9)} ${f(-rx * 0.9)} ${f(14)} ${f(-rx * 0.96)} ${f(24)} C${f(-rx * 0.92)} ${f(36)} ${f(-rx - 1)} ${f(41)} ${f(-rx - 2.6)} ${f(40)} Z` +
      // A bun on top.
      ` ${closedPath([[0, -13], [7.6, -8], [6.8, -1], [0, 1.5], [-6.8, -1], [-7.6, -8]])}`;

  /* Sports top: the torso's outline, a little outside it, to the hem. */
  const pad = 1.3;
  const topRight: Point[] = torsoRight
    .filter(([, y]) => y <= Y.hem)
    .map(([x, y], i) => [x + (i === 0 ? 2.4 : pad), y + (i === 0 ? 1 : 0)] as Point);
  const hemX = edgeAt(torsoRight, Y.hem) + pad;
  topRight.push([hemX, Y.hem]);
  const neckDip = male ? Y.neckBase + 8 : Y.neckBase + 15;
  const top =
    `${move([-topRight[0][0], topRight[0][1]])}` +
    ` Q0 ${f(neckDip)} ${f(topRight[0][0])} ${f(topRight[0][1])}` +
    curveThrough(topRight) +
    ` Q0 ${f(Y.hem + 4)} ${f(-hemX)} ${f(Y.hem)}` +
    curveThrough(mirror(topRight)) +
    " Z";

  /* Sleeves: short (men) or cap sleeves (women), over the top of the arm. */
  // Short enough that the upper arm (biceps, triceps) shows.
  const sleeveTo = male ? 0.2 : 0.15;
  const sleeve = (sign: 1 | -1) => {
    const { outer, inner } = armEdges(0.7, sleeveTo);
    const o: Point[] = [[capIn[0], capIn[1] - 1], [cap[0], cap[1] - 1], ...outer];
    const i: Point[] = [[capIn[0] - 1, capIn[1] + 3], ...inner];
    return ribbon(sign === 1 ? o : flip(o), sign === 1 ? i : flip(i));
  };
  const sleeves = `${sleeve(1)} ${sleeve(-1)}`;

  /* Shorts: from under the top's hem to mid-thigh; loose for men, fitted for women. */
  const legOuterAt = (y: number) => edgeAt(legOuter, y);
  const legInnerAt = (y: number) => edgeAt(legInner, y);
  const sTop = Y.hem - 10;
  const sHem = Y.shortsHem;
  const looseness = male ? 3.2 : 1;
  const outerR: Point[] = [
    [edgeAt(torsoRight, sTop) + 0.8, sTop],
    [s.hip + (male ? 1.6 : 0.9), Y.hip],
    [legOuterAt(236) + looseness * 0.8, 236],
    [legOuterAt(sHem) + looseness, sHem],
  ];
  const innerHemX = legInnerAt(sHem) - looseness * 0.7;
  const crotchY = Y.crotch + (male ? 8 : 4);
  const shortsRight =
    curveThrough(outerR) +
    line([innerHemX, sHem + (male ? 1 : 0)]) +
    ` Q${f(Math.max(innerHemX * 0.35, 0.5))} ${f(crotchY + 2)} 0 ${f(crotchY)}`;
  const outerL = flip(outerR);
  const shorts =
    `${move(outerR[0])}${shortsRight}` +
    ` Q${f(-Math.max(innerHemX * 0.35, 0.5))} ${f(crotchY + 2)} ${f(-innerHemX)} ${f(sHem + (male ? 1 : 0))}` +
    line(outerL[3]) +
    curveThrough([...outerL].reverse()) +
    " Z";

  /* Accent stripes: down the sides of the shorts, and a neckline band. */
  const stripe = (sign: 1 | -1) => {
    const pts = outerR.slice(1).map(([x, y]) => [sign * (x - 0.4), y] as Point);
    const insetPts = outerR.slice(1).map(([x, y]) => [sign * (x - 2.6), y] as Point);
    return ribbon(pts, insetPts);
  };
  const accents = `${stripe(1)} ${stripe(-1)}`;

  /* Detail lines. Muscle: chest, deltoid and quads; fat: a soft fold over the belly (men) or at the waist. */
  const quad = (sign: 1 | -1) => {
    const cx = cxKnee - s.knee * 0.25;
    return `${move([sign * (cx - s.thigh * 0.45), 262])} Q${f(sign * (cx - s.thigh * 0.62))} ${f(279)} ${f(sign * (cx - s.knee * 0.15))} ${f(KNEE_Y - 6)}`;
  };
  const kneeCap = (sign: 1 | -1) =>
    `${move([sign * (cxKnee - s.knee * 0.55), KNEE_Y + 4])} Q${f(sign * cxKnee)} ${f(KNEE_Y + 9)} ${f(sign * (cxKnee + s.knee * 0.55))} ${f(KNEE_Y + 4)}`;
  const pec = (sign: 1 | -1) =>
    `${move([sign * s.chest * 0.88, Y.chest + 4])} Q${f(sign * s.chest * 0.5)} ${f(Y.chest + 13)} ${f(sign * 2.5)} ${f(Y.chest + 8)}`;
  // The inner head of the calf, and the lats' edge down the sides of the top.
  const calfLine = (sign: 1 | -1) => {
    const cx = cxKnee + 0.6;
    return `${move([sign * (cx - s.calf * 0.35), KNEE_Y + 12])} Q${f(sign * (cx - s.calf * 0.95))} ${f(CALF_Y)} ${f(sign * (cx - s.calf * 0.45))} ${f(CALF_Y + 22)}`;
  };
  const lat = (sign: 1 | -1) =>
    `${move([sign * (s.chest * 0.92), Y.armpit + 6])} Q${f(sign * (s.chest * 0.8))} ${f(Y.rib + 8)} ${f(sign * (s.waist * 0.86))} ${f(Y.waist + 4)}`;
  const chestLines = male ? `${pec(1)} ${pec(-1)} ${lat(1)} ${lat(-1)}` : "";
  const legLines = `${quad(1)} ${quad(-1)} ${kneeCap(1)} ${kneeCap(-1)} ${calfLine(1)} ${calfLine(-1)}`;
  // Low muscle: almost no definition lines; muscular: clear ones.
  const muscleOpacity = male ? 0.04 + 0.6 * s.muscle : 0.04 + 0.4 * s.muscle;
  const foldY = male ? Y.belly + 10 : Y.belly + 6;
  const fatLines =
    `${move([-s.belly * 0.82, foldY - 5])} Q0 ${f(foldY + 8 + 4 * a)} ${f(s.belly * 0.82)} ${f(foldY - 5)}` +
    (male ? "" : ` ${move([-s.chest * 0.8, Y.chest + 6])} Q0 ${f(Y.chest + 12)} ${f(s.chest * 0.8)} ${f(Y.chest + 6)}`);
  const fatOpacity = male ? Math.min(Math.max((s.fat - 0.35) * 0.55, 0), 0.5) : Math.min(0.12 + Math.max(s.fat - 0.3, 0) * 0.4, 0.45);

  return {
    head,
    hair,
    ears,
    neck,
    torso,
    legs,
    shoes,
    soles,
    arms,
    hands,
    top,
    sleeves,
    shorts,
    accents,
    chestLines,
    legLines,
    muscleOpacity,
    fatLines,
    fatOpacity,
    footprint: Math.max(s.hip, ankleCx + shoeW) + 8,
  };
}

/* ---------------------------------------------------------------------------------------
   Tween
   --------------------------------------------------------------------------------------- */

type Params = { bodyFat: number; muscle: number; height: number };

/** Tweens the parameters to `target` over TWEEN_MS (ease-out cubic); instant with prefers-reduced-motion. */
function useTween(target: Params, sex: Sex): Params {
  const [shown, setShown] = useState(target);
  const current = useRef(target);
  const lastSex = useRef(sex);

  useEffect(() => {
    const from = current.current;
    const sexChanged = lastSex.current !== sex;
    lastSex.current = sex;
    if (from.bodyFat === target.bodyFat && from.muscle === target.muscle && from.height === target.height) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = reduce || sexChanged ? 0 : TWEEN_MS;
    let frame = 0;
    let startedAt: number | null = null;
    const tick = (now: number) => {
      startedAt ??= now;
      const progress = duration === 0 ? 1 : Math.min((now - startedAt) / duration, 1);
      const eased = 1 - (1 - progress) ** 3;
      const next: Params =
        progress === 1
          ? target
          : {
              bodyFat: lerp(from.bodyFat, target.bodyFat, eased),
              muscle: lerp(from.muscle, target.muscle, eased),
              height: lerp(from.height, target.height, eased),
            };
      current.current = next;
      setShown(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, sex]);

  return shown;
}

/* ---------------------------------------------------------------------------------------
   Component
   --------------------------------------------------------------------------------------- */

const COLORS = {
  skin: "color-mix(in srgb, var(--color-gold) 46%, var(--color-ivory))",
  skinShade: "color-mix(in srgb, var(--color-gold) 72%, var(--color-ivory))",
  outline: "color-mix(in srgb, var(--color-forest) 30%, transparent)",
  hair: "var(--color-forest-deep)",
  top: "var(--color-forest)",
  shorts: "var(--color-forest-deep)",
  shoe: "var(--color-forest-soft)",
  sole: "var(--color-ivory)",
  ruler: "var(--color-sage)",
} as const;

export function BodyFigure({
  sex,
  bodyFat,
  muscularity,
  height,
  accent = "sage",
  ruler = true,
  rulerLabels = true,
  className,
}: {
  sex: Sex;
  /** Body fat (%), as from bodyFatFor(). */
  bodyFat: number;
  muscularity: Muscularity;
  /** cm. */
  height: number;
  /** The stripe colour: sage for "now", gold for "goal". */
  accent?: "sage" | "gold";
  /** Faint lines at 150, 175 and 200 cm, drawn on past the frame so two figures side by side share them. */
  ruler?: boolean;
  /** The numbers on those lines (only one of two figures side by side needs them). */
  rulerLabels?: boolean;
  className?: string;
}) {
  const muscle = MUSCLE[muscularity];
  // A stable object per distinct target, so the tween effect runs only when a value changes.
  const target = useMemo<Params>(() => ({ bodyFat, muscle, height }), [bodyFat, muscle, height]);
  const shown = useTween(target, sex);
  const parts = buildParts(shapeOf(sex, shown.bodyFat, shown.muscle));
  const scale = shown.height / FRAME_CM;
  const shade = useId().replace(/:/g, "");
  const accentColor = accent === "gold" ? "var(--color-gold)" : "var(--color-sage)";
  const groundTop = GROUND_Y - FIGURE_UNITS * scale;

  return (
    <svg
      viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.width} ${VIEW.height}`}
      className={className}
      aria-hidden
      focusable="false"
      preserveAspectRatio="xMidYMax meet"
      overflow="visible"
    >
      <defs>
        <linearGradient id={`${shade}-skin`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" style={{ stopColor: COLORS.skin }} />
          <stop offset="0.62" style={{ stopColor: COLORS.skin }} />
          <stop offset="1" style={{ stopColor: COLORS.skinShade }} />
        </linearGradient>
        <linearGradient id={`${shade}-cloth`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" style={{ stopColor: "#fff", stopOpacity: 0.07 }} />
          <stop offset="0.55" style={{ stopColor: "#fff", stopOpacity: 0 }} />
          <stop offset="1" style={{ stopColor: "#000", stopOpacity: 0.12 }} />
        </linearGradient>
      </defs>

      {ruler && (
        <g style={{ color: COLORS.ruler }}>
          {RULER_CM.map((cm) => {
            const y = GROUND_Y - (FIGURE_UNITS * cm) / FRAME_CM;
            return (
              <g key={cm}>
                <line x1={-400} x2={400} y1={y} y2={y} stroke="currentColor" strokeWidth={0.8} strokeDasharray="2 4" opacity={0.7} />
                {rulerLabels && (
                  // Too small to read on phones, where the figure is drawn smallest.
                  <text x={VIEW.x + 1} y={y - 3} fontSize={12} fill="currentColor" className="max-sm:hidden" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {cm}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      )}

      <ellipse cx={0} cy={GROUND_Y} rx={parts.footprint * scale} ry={4 * scale + 1} fill="var(--color-forest)" opacity={0.12} />

      <g transform={`translate(0 ${f(groundTop)}) scale(${scale.toFixed(4)})`} strokeLinejoin="round" strokeLinecap="round">
        <g fill={`url(#${shade}-skin)`} stroke={COLORS.outline} strokeWidth={1}>
          <path d={parts.legs} />
          <path d={parts.torso} />
          <path d={parts.neck} />
          <path d={parts.ears} />
          <path d={parts.head} />
        </g>
        <path d={parts.hair} fill={COLORS.hair} />

        <path d={parts.shorts} fill={COLORS.shorts} />
        <path d={parts.accents} fill={accentColor} opacity={0.9} />
        <path d={parts.shorts} fill={`url(#${shade}-cloth)`} />

        <path d={parts.top} fill={COLORS.top} />
        <path d={parts.top} fill={`url(#${shade}-cloth)`} />
        <path d={parts.fatLines} fill="none" stroke="var(--color-forest-deep)" strokeWidth={1.4} opacity={parts.fatOpacity} />
        {parts.chestLines && (
          <path d={parts.chestLines} fill="none" stroke="var(--color-forest-deep)" strokeWidth={1.3} opacity={parts.muscleOpacity} />
        )}

        <g fill={`url(#${shade}-skin)`} stroke={COLORS.outline} strokeWidth={1}>
          <path d={parts.arms} />
          <path d={parts.hands} />
        </g>
        <path d={parts.sleeves} fill={COLORS.top} />
        <path d={parts.sleeves} fill={`url(#${shade}-cloth)`} />

        <path d={parts.legLines} fill="none" stroke="var(--color-forest)" strokeWidth={1} opacity={parts.muscleOpacity * 0.6} />

        <path d={parts.shoes} fill={COLORS.shoe} />
        <path d={parts.soles} fill={COLORS.sole} />
      </g>
    </svg>
  );
}
