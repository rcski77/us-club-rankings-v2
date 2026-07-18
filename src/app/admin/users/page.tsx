import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { UserRole, UserStatus } from "@/generated/prisma/enums";

async function updateUser(userId: string, status: UserStatus, role: UserRole) {
  "use server";
  const session = await auth();
  if (session?.user.role !== "SUPER_ADMIN") throw new Error("Forbidden");

  await prisma.user.update({ where: { id: userId }, data: { status, role } });
  revalidatePath("/admin/users");
}

export default async function AdminUsersPage() {
  const session = await auth();
  if (session?.user.role !== "SUPER_ADMIN") redirect("/admin");

  const users = await prisma.user.findMany({ orderBy: { createdAt: "desc" } });
  const pending = users.filter((u) => u.status === "PENDING");
  const others = users.filter((u) => u.status !== "PENDING");

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Users</h1>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-medium">Pending approval ({pending.length})</h2>
        {pending.length === 0 && <p className="text-sm text-slate-500">None.</p>}
        <ul className="flex flex-col gap-2">
          {pending.map((u) => (
            <li
              key={u.id}
              className="flex items-center justify-between rounded border px-3 py-2"
            >
              <span>
                {u.name ? `${u.name} — ` : ""}
                {u.email}
              </span>
              <div className="flex gap-2">
                <form
                  action={async () => {
                    "use server";
                    await updateUser(u.id, "ACTIVE", "ADMIN");
                  }}
                >
                  <button type="submit" className="rounded bg-slate-900 px-2 py-1 text-xs text-white">
                    Approve as Admin
                  </button>
                </form>
                <form
                  action={async () => {
                    "use server";
                    await updateUser(u.id, "DISABLED", "PENDING");
                  }}
                >
                  <button type="submit" className="rounded border px-2 py-1 text-xs">
                    Reject
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium">All other users</h2>
        <ul className="flex flex-col gap-2">
          {others.map((u) => (
            <li
              key={u.id}
              className="flex items-center justify-between rounded border px-3 py-2 text-sm"
            >
              <span>
                {u.name ? `${u.name} — ` : ""}
                {u.email} ({u.role}, {u.status})
              </span>
              {u.status === "DISABLED" && (
                <form
                  action={async () => {
                    "use server";
                    await updateUser(u.id, "ACTIVE", "ADMIN");
                  }}
                >
                  <button type="submit" className="rounded border px-2 py-1 text-xs">
                    Re-enable as Admin
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
