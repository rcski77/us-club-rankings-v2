// Thresholds for judging background recompute health -- shared by /admin/job-runs
// (the full list) and the dashboard (its needs-attention summary).

// A RUNNING row this old almost certainly belongs to a run whose parent process died
// before it could mark SUCCEEDED/FAILED -- every trigger's own "started" banner tells
// staff to expect a minute or two, so nothing legitimate stays RUNNING this long.
export const STALE_RUNNING_MINUTES = 15;

// The nightly job runs once a day (see scheduleNightlyRecompute.ts) -- 36h gives a
// full day's margin before flagging silence, so a single slow night or a redeploy
// that briefly delays the timer doesn't false-positive. This is the "nobody's
// watching" gap that let the 8/14 nightly failure go unnoticed: the JobRun row was
// always there, but nothing surfaced it unless someone thought to look.
export const NIGHTLY_STALE_HOURS = 36;
