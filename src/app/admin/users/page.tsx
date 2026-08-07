import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { UserRole, UserStatus } from "@/generated/prisma/enums";
import { inputClass, selectClass, primaryButtonClass, errorBannerClass } from "@/lib/ui";

async function updateUser(userId: string, status: UserStatus, role: UserRole) {
  "use server";
  const session = await auth();
  if (session?.user.role !== "SUPER_ADMIN") throw new Error("Forbidden");

  await prisma.user.update({ where: { id: userId }, data: { status, role } });
  revalidatePath("/admin/users");
}

async function deactivateUser(userId: string) {
  "use server";
  const session = await auth();
  if (session?.user.role !== "SUPER_ADMIN") throw new Error("Forbidden");
  if (session.user.id === userId) redirect("/admin/users?error=self-deactivate");

  await prisma.user.update({ where: { id: userId }, data: { status: "DISABLED" } });
  revalidatePath("/admin/users");
}

async function reactivateUser(userId: string) {
  "use server";
  const session = await auth();
  if (session?.user.role !== "SUPER_ADMIN") throw new Error("Forbidden");

  await prisma.user.update({ where: { id: userId }, data: { status: "ACTIVE" } });
  revalidatePath("/admin/users");
}

async function createUser(formData: FormData) {
  "use server";
  const session = await auth();
  if (session?.user.role !== "SUPER_ADMIN") throw new Error("Forbidden");

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim() || null;
  const password = String(formData.get("password") ?? "");
  const roleRaw = String(formData.get("role") ?? "ADMIN");
  const role: UserRole = roleRaw === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN";

  if (!email || password.length < 8) redirect("/admin/users?error=invalid");

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) redirect("/admin/users?error=exists");

  const passwordHash = await hashPassword(password);
  await prisma.user.create({
    data: { email, name, passwordHash, role, status: "ACTIVE" },
  });

  revalidatePath("/admin/users");
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user.role !== "SUPER_ADMIN") redirect("/admin");

  const { error } = await searchParams;
  const users = await prisma.user.findMany({ orderBy: { createdAt: "desc" } });
  const pending = users.filter((u) => u.status === "PENDING");
  const others = users.filter((u) => u.status !== "PENDING");

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Users</h1>

      <section className="mb-8 max-w-sm">
        <h2 className="mb-2 text-lg font-medium">Create user</h2>
        {error === "invalid" && (
          <p className={errorBannerClass}>Enter a valid email and a password of at least 8 characters.</p>
        )}
        {error === "exists" && (
          <p className={errorBannerClass}>An account with that email already exists.</p>
        )}
        {error === "self-deactivate" && (
          <p className={errorBannerClass}>You can&apos;t deactivate your own account.</p>
        )}
        <form action={createUser} className="flex flex-col gap-3">
          <input name="name" type="text" placeholder="Name" className={inputClass} />
          <input name="email" type="email" placeholder="Email" required className={inputClass} />
          <input
            name="password"
            type="password"
            placeholder="Password (min 8 characters)"
            required
            minLength={8}
            className={inputClass}
          />
          <select name="role" defaultValue="ADMIN" className={selectClass}>
            <option value="ADMIN">Admin</option>
            <option value="SUPER_ADMIN">Super Admin</option>
          </select>
          <button type="submit" className={`${primaryButtonClass} self-start`}>
            Create user
          </button>
        </form>
      </section>

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
                {u.id === session.user.id && " — you"}
              </span>
              {u.status === "DISABLED" && u.role === "PENDING" && (
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
              {u.status === "DISABLED" && u.role !== "PENDING" && (
                <form
                  action={async () => {
                    "use server";
                    await reactivateUser(u.id);
                  }}
                >
                  <button type="submit" className="rounded border px-2 py-1 text-xs">
                    Reactivate
                  </button>
                </form>
              )}
              {u.status === "ACTIVE" && u.id !== session.user.id && (
                <form
                  action={async () => {
                    "use server";
                    await deactivateUser(u.id);
                  }}
                >
                  <button
                    type="submit"
                    className="rounded border border-red-300 px-2 py-1 text-xs text-red-700"
                  >
                    Deactivate
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
