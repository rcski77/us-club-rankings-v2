import Link from "next/link";

export type Crumb = { label: string; href?: string };

// Shared breadcrumb trail for admin detail/nested pages -- last item is the current
// page and is rendered as plain text, everything before it links to its parent.
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1 text-sm text-slate-500">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="text-slate-400">/</span>}
          {item.href ? (
            <Link href={item.href} prefetch={false} className="underline">
              {item.label}
            </Link>
          ) : (
            <span>{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
