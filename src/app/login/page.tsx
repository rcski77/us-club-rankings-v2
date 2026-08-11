import type { Metadata } from "next";
import { signIn } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

export const metadata: Metadata = { title: "Sign In" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string; registered?: string }>;
}) {
  const { callbackUrl, error, registered } = await searchParams;

  return (
    <div className="mx-auto mt-24 max-w-sm">
      <h1 className="mb-6 text-2xl font-semibold">Sign in</h1>
      {registered && (
        <p className="mb-4 rounded bg-green-50 p-3 text-sm text-green-700">
          A request has been sent to an admin for approval.
        </p>
      )}
      {error === "disabled" && (
        <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">
          Your account has been deactivated. Contact a super admin if you think
          this is a mistake.
        </p>
      )}
      {error === "locked" && (
        <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">
          Too many failed sign-in attempts. Try again in 15 minutes.
        </p>
      )}
      {error === "rate_limited" && (
        <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">
          Too many sign-in attempts from your network. Try again in a minute.
        </p>
      )}
      {error && error !== "disabled" && error !== "locked" && error !== "rate_limited" && (
        <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">
          Invalid email or password.
        </p>
      )}
      <form
        action={async (formData) => {
          "use server";
          const email = String(formData.get("email") ?? "");
          const password = String(formData.get("password") ?? "");
          const result = await signIn(email, password);
          if (!result.ok) {
            const params = new URLSearchParams({ error: result.reason });
            if (callbackUrl) params.set("callbackUrl", callbackUrl);
            redirect(`/login?${params.toString()}`);
          }
          redirect(callbackUrl ?? "/admin");
        }}
        className="flex flex-col gap-4"
      >
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
          placeholder="Password"
          required
          className="rounded border px-3 py-2"
        />
        <button
          type="submit"
          className="rounded bg-slate-900 px-3 py-2 text-white hover:bg-slate-800"
        >
          Sign in
        </button>
      </form>
      <p className="mt-4 text-sm text-slate-600">
        Need an account?{" "}
        <Link href="/register" className="underline">
          Register
        </Link>
      </p>
    </div>
  );
}
