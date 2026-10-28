import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";
import { AdminNav } from "./AdminNav";

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
        <AdminNav isSuperAdmin={user.role === "SUPER_ADMIN"} />
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
      <main className="min-w-0 flex-1 p-6">{children}</main>
    </div>
  );
}
