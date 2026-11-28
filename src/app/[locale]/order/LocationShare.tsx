"use client";

import { useEffect, useRef, useState } from "react";
import type { Dictionary } from "@/i18n";
import {
  LOCATION_FIELDS,
  LOCATION_MAX_ACCURACY_M,
  LOCATION_TIMEOUT_MS,
  formatCoord,
  inTashkent,
  roundCoord,
  type LatLng,
} from "@/lib/order/location";

/** A point the visitor shared, with the fix's accuracy in whole metres (shown, never sent). */
export type SharedLocation = LatLng & { accuracy: number };

type Problem = { kind: "denied" | "unavailable" | "outside" | "rough"; accuracy?: number };

/**
 * "Share my location" under the order form's address (docs/plans/customer-site-improvements.md, round 1, item 7).
 * Optional: the text address stays required whatever happens here. One tap asks the browser for one high-accuracy fix
 * (10 s); a point inside Tashkent's box and within LOCATION_MAX_ACCURACY_M becomes two hidden fields, checked again on
 * the server. Permission refused, no fix, outside Tashkent or too rough: a line says so and nothing is added.
 *
 * The point lives in the form's state only: never in localStorage (the draft holds plan choices only), a URL or an
 * analytics event. data-ph-mask keeps the shown line out of autocapture and replays; ph-no-capture keeps the hidden
 * fields (whose value attributes hold the numbers) out of replays altogether.
 */
export function LocationShare({
  t,
  value,
  onChange,
}: {
  t: Dictionary["order"]["location"];
  value: SharedLocation | null;
  onChange: (value: SharedLocation | null) => void;
}) {
  const [locating, setLocating] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  // Each request gets a number; an answer that arrives after Remove (or after the form went away) is dropped.
  const call = useRef(0);
  useEffect(
    () => () => {
      call.current += 1;
    },
    [],
  );

  function share() {
    if (locating) return;
    setProblem(null);
    const geo = typeof navigator === "undefined" ? undefined : navigator.geolocation;
    if (!geo) {
      setProblem({ kind: "unavailable" });
      return;
    }
    const id = ++call.current;
    setLocating(true);
    geo.getCurrentPosition(
      (position) => {
        if (id !== call.current) return;
        setLocating(false);
        const { latitude, longitude, accuracy } = position.coords;
        const metres = Math.max(1, Math.round(accuracy));
        if (!inTashkent(latitude, longitude)) setProblem({ kind: "outside" });
        else if (!(accuracy <= LOCATION_MAX_ACCURACY_M)) setProblem({ kind: "rough", accuracy: metres });
        else onChange({ lat: roundCoord(latitude), lng: roundCoord(longitude), accuracy: metres });
      },
      (error) => {
        if (id !== call.current) return;
        setLocating(false);
        // 1: permission denied; 2: position unavailable; 3: timeout.
        setProblem({ kind: error.code === 1 ? "denied" : "unavailable" });
      },
      { enableHighAccuracy: true, timeout: LOCATION_TIMEOUT_MS, maximumAge: 0 },
    );
  }

  function remove() {
    call.current += 1;
    setLocating(false);
    setProblem(null);
    onChange(null);
  }

  const problemText = problem
    ? t[problem.kind].replace("{m}", String(problem.accuracy ?? ""))
    : null;

  return (
    <div className="mt-3 grid gap-2" data-order-location>
      {value ? (
        <div className="flex flex-wrap items-center gap-x-3">
          <p role="status" data-ph-mask className="text-sm font-semibold text-forest">
            {t.added.replace("{m}", String(value.accuracy))}
          </p>
          <button
            type="button"
            onClick={remove}
            aria-label={t.removeLabel}
            className="-my-2 inline-flex min-h-11 items-center px-1 text-sm font-semibold text-forest underline decoration-gold underline-offset-4"
          >
            {t.remove}
          </button>
          <span className="ph-no-capture">
            <input type="hidden" name={LOCATION_FIELDS.lat} value={formatCoord(value.lat)} />
            <input type="hidden" name={LOCATION_FIELDS.lng} value={formatCoord(value.lng)} />
          </span>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={share}
            disabled={locating}
            aria-describedby="order-location-note"
            className={`btn btn-outline min-h-11 justify-self-start !px-4 !py-2 !text-sm text-forest ${locating ? "opacity-70" : ""}`}
          >
            {locating ? <Spinner /> : <Pin />}
            {t.share}
          </button>
          {/* One line under the button: what it is for, then the wait, then why nothing was added. */}
          <p
            id="order-location-note"
            role="status"
            className={`text-sm ${problem ? "rounded-xl bg-ivory-deep px-3 py-2 text-graphite" : "text-muted"}`}
          >
            {locating ? t.locating : (problemText ?? t.hint)}
          </p>
        </>
      )}
    </div>
  );
}

function Pin() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-4 shrink-0" aria-hidden>
      <path
        d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10" r="2.25" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-4 shrink-0 animate-spin" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
