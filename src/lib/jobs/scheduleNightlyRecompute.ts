import { runNightlyRecompute } from "./nightlyRecompute";

// 2 AM Eastern -- after essentially all tournament data for the day has been imported,
// well before staff start work. Same zone as the "as of" rating timestamps
// (team-rankings/page.tsx) so a staff member reading "recomputed at 2:xx AM EST" lines
// up with when this actually ran.
const TARGET_HOUR = 2;
const TIME_ZONE = "America/New_York";
const CHECK_INTERVAL_MS = 60_000;

function currentEasternTime(): { dateKey: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  // formatToParts gives "24" for midnight with hour12: false in some environments --
  // normalize to 0 so the TARGET_HOUR comparison below is reliable.
  const hour = Number(get("hour")) % 24;
  return { dateKey: `${get("year")}-${get("month")}-${get("day")}`, hour };
}

/**
 * Starts the nightly poll. Idempotent-per-process guard (module-level flag) since
 * `register()` in instrumentation.ts is documented to run once per server instance,
 * but this makes a second accidental call harmless rather than doubling the schedule.
 */
let started = false;

export function startNightlyRecomputeScheduler(): void {
  if (started) return;
  started = true;

  let lastRunDateKey: string | null = null;

  const tick = () => {
    const { dateKey, hour } = currentEasternTime();
    if (hour !== TARGET_HOUR || dateKey === lastRunDateKey) return;

    lastRunDateKey = dateKey;
    console.log(`[nightlyRecompute] starting run for ${dateKey}`);
    runNightlyRecompute()
      .then(() => console.log(`[nightlyRecompute] finished run for ${dateKey}`))
      .catch((err) => console.error(`[nightlyRecompute] run for ${dateKey} failed:`, err));
  };

  setInterval(tick, CHECK_INTERVAL_MS).unref();
}
