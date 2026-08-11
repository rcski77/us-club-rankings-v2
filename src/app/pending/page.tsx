import type { Metadata } from "next";
import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Pending Approval" };

export default async function PendingPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.status === "ACTIVE") redirect("/admin");

  return (
    <div className="mx-auto mt-24 max-w-md text-center">
      <h1 className="mb-4 text-2xl font-semibold">Account pending approval</h1>
      <p className="text-slate-600">
        Your account ({session.user.email}) has been created but hasn&apos;t been
        approved by an administrator yet. Check back soon, or contact an existing
        admin to speed things along.
      </p>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
        className="mt-6"
      >
        <button type="submit" className="rounded border px-3 py-2 text-sm">
          Sign out
        </button>
      </form>
    </div>
  );
}
