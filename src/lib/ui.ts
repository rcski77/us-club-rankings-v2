export const inputClass = "rounded border px-3 py-2 text-sm";
export const selectClass = inputClass;
// Native file inputs can only be styled via the `file:` pseudo-element variant --
// this makes the browser-generated "Choose File" control match secondaryButtonClass.
export const fileInputClass =
  "text-sm text-slate-500 file:mr-3 file:cursor-pointer file:rounded file:border file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-900 file:transition-colors file:hover:border-slate-400 file:hover:bg-slate-100";
export const primaryButtonClass =
  "rounded bg-slate-900 px-3 py-2 text-sm text-white transition-colors hover:bg-slate-700 disabled:opacity-50 disabled:hover:bg-slate-900";
export const secondaryButtonClass =
  "rounded border px-3 py-2 text-sm transition-colors hover:border-slate-400 hover:bg-slate-100 disabled:opacity-50 disabled:hover:border-inherit disabled:hover:bg-transparent";
export const smallPrimaryButtonClass =
  "rounded bg-slate-900 px-2 py-1 text-xs text-white transition-colors hover:bg-slate-700 disabled:opacity-50 disabled:hover:bg-slate-900";
export const smallSecondaryButtonClass =
  "rounded border px-2 py-1 text-xs transition-colors hover:border-slate-400 hover:bg-slate-100 disabled:opacity-50 disabled:hover:border-inherit disabled:hover:bg-transparent";
export const errorBannerClass = "mb-4 rounded bg-red-50 p-3 text-sm text-red-700";
export const successBannerClass = "mb-4 rounded bg-green-50 p-3 text-sm text-green-700";
export const tableClass = "w-full border-collapse text-sm";
export const thClass = "border-b px-3 py-2 text-left font-medium text-slate-600";
export const tdClass = "border-b px-3 py-2";
// Zebra striping + row hover for tables of scannable data (many rows, mostly numbers) --
// apply to <tbody>, not <table>, since header rows shouldn't stripe.
export const stripedTbodyClass = "[&>tr:nth-child(even)]:bg-slate-50 [&>tr:hover]:bg-slate-100";

const badgeBaseClass = "inline-block rounded-full px-2 py-0.5 text-xs font-medium";

// Division.scoringStatus (prisma/schema.prisma) -- coarse workflow state.
export function scoringStatusBadgeClass(status: "DRAFT" | "SUGGESTED" | "CONFIRMED") {
  switch (status) {
    case "CONFIRMED":
      return `${badgeBaseClass} bg-green-100 text-green-800`;
    case "SUGGESTED":
      return `${badgeBaseClass} bg-amber-100 text-amber-800`;
    case "DRAFT":
      return `${badgeBaseClass} bg-slate-200 text-slate-600`;
  }
}

// ScoreBand (src/lib/rating/suggestPointTemplate.ts) -- field-strength tier.
export function scoreBandBadgeClass(band: "Elite field" | "Strong regional" | "Solid regional" | "Developmental") {
  switch (band) {
    case "Elite field":
      return `${badgeBaseClass} bg-purple-100 text-purple-800`;
    case "Strong regional":
      return `${badgeBaseClass} bg-blue-100 text-blue-800`;
    case "Solid regional":
      return `${badgeBaseClass} bg-teal-100 text-teal-800`;
    case "Developmental":
      return `${badgeBaseClass} bg-slate-200 text-slate-600`;
  }
}
