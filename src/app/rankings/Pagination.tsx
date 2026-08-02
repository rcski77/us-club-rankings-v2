import Link from "next/link";

export const DEFAULT_PAGE_SIZE = 100;

export function parsePage(pageParam?: string): number {
  const n = Number(pageParam);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/** Prev/next + range summary for a paginated public list. `baseParams` should carry
 * every other filter (season, view, sort, ...) but not `page` -- this component sets
 * that itself per link. Renders nothing when everything fits on one page. */
export function Pagination({
  page,
  totalCount,
  pageSize,
  basePath,
  baseParams,
}: {
  page: number;
  totalCount: number;
  pageSize: number;
  basePath: string;
  baseParams: URLSearchParams;
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  if (totalPages <= 1) return null;

  function hrefFor(p: number) {
    const params = new URLSearchParams(baseParams);
    params.set("page", String(p));
    return `${basePath}?${params}`;
  }

  const start = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalCount);

  return (
    <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
      <span>
        {start}–{end} of {totalCount}
      </span>
      <div className="flex items-center gap-3">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className="hover:text-slate-800 hover:underline">
            ← Prev
          </Link>
        ) : (
          <span className="text-slate-300">← Prev</span>
        )}
        <span>
          Page {page} of {totalPages}
        </span>
        {page < totalPages ? (
          <Link href={hrefFor(page + 1)} className="hover:text-slate-800 hover:underline">
            Next →
          </Link>
        ) : (
          <span className="text-slate-300">Next →</span>
        )}
      </div>
    </div>
  );
}
