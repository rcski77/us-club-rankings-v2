import { auth, signOut } from "@/auth";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user || session.user.status !== "ACTIVE") {
    redirect("/login");
  }

  const { user } = session;

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r bg-slate-50 p-4">
        <div className="mb-6 font-semibold">US Club Rankings</div>
        <nav className="flex flex-col gap-1 text-sm">
          <Link href="/admin" className="rounded px-2 py-1 hover:bg-slate-200">
            Dashboard
          </Link>
          <Link href="/admin/events" className="rounded px-2 py-1 hover:bg-slate-200">
            Events
          </Link>
          <Link href="/admin/imports" className="rounded px-2 py-1 hover:bg-slate-200">
            Imports
          </Link>
          <Link href="/admin/team-rankings" className="rounded px-2 py-1 hover:bg-slate-200">
            Team Rankings
          </Link>
          <Link href="/admin/analysis" className="rounded px-2 py-1 hover:bg-slate-200">
            Analysis
          </Link>
          <Link href="/admin/point-templates" className="rounded px-2 py-1 hover:bg-slate-200">
            Point Templates
          </Link>
          <Link href="/admin/teams" className="rounded px-2 py-1 hover:bg-slate-200">
            Teams
          </Link>
          <Link href="/admin/clubs" className="rounded px-2 py-1 hover:bg-slate-200">
            Clubs
          </Link>
          <Link href="/admin/regions" className="rounded px-2 py-1 hover:bg-slate-200">
            Regions
          </Link>
          <Link href="/admin/seasons" className="rounded px-2 py-1 hover:bg-slate-200">
            Seasons
          </Link>
          {user.role === "SUPER_ADMIN" && (
            <Link href="/admin/users" className="rounded px-2 py-1 hover:bg-slate-200">
              Users
            </Link>
          )}
        </nav>
        <div className="mt-8 border-t pt-4 text-xs text-slate-500">
          <div>{user.email}</div>
          <div className="mb-2">{user.role}</div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button type="submit" className="underline">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
