import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { redirect } from "next/navigation";
import Link from "next/link";

async function registerAction(formData: FormData) {
  "use server";

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !name || password.length < 8) {
    redirect("/register?error=invalid");
  }

  // Hash before the existence check (not after, and not skipped when the
  // account already exists) so the two branches below take roughly the same
  // time -- scrypt dominates either way, so a response-timing comparison
  // can't be used to tell "already registered" apart from "newly created"
  // the way an early-return on `existing` would allow.
  const passwordHash = await hashPassword(password);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    await prisma.user.create({
      data: { email, name, passwordHash, role: "PENDING", status: "PENDING" },
    });
  }

  // Deliberately the same redirect either way -- see the page's "registered"
  // banner. Confirming "an account already exists" here would let anyone
  // enumerate registered emails for free; this way, /login is the only place
  // that ever confirms a login actually succeeded.
  redirect("/login?registered=1");
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="mx-auto mt-24 max-w-sm">
      <h1 className="mb-6 text-2xl font-semibold">Create an account</h1>
      {error === "invalid" && (
        <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">
          Enter a valid email and a password of at least 8 characters.
        </p>
      )}
      {!error && (
        <p className="mb-4 text-sm text-slate-500">
          New accounts require admin approval before you can access the admin area.
        </p>
      )}
      <form action={registerAction} className="flex flex-col gap-4">
        <input
          name="name"
          type="text"
          placeholder="Name"
          required
          className="rounded border px-3 py-2"
        />
        <input
          name="email"
          type="email"
          placeholder="Email"
          required
          className="rounded border px-3 py-2"
        />
        <input
          name="password"
          type="password"
          placeholder="Password (min 8 characters)"
          required
          minLength={8}
          className="rounded border px-3 py-2"
        />
        <button
          type="submit"
          className="rounded bg-slate-900 px-3 py-2 text-white hover:bg-slate-800"
        >
          Register
        </button>
      </form>
      <p className="mt-4 text-sm text-slate-600">
        Already have an account?{" "}
        <Link href="/login" className="underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
