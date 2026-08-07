import { signIn } from "@/auth";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";

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
          Account created. Sign in to see your approval status.
        </p>
      )}
      {error === "disabled" && (
        <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">
          Your account has been deactivated. Contact a super admin if you think
          this is a mistake.
        </p>
      )}
      {error && error !== "disabled" && (
        <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">
          Invalid email or password.
        </p>
      )}
      <form
        action={async (formData) => {
          "use server";
          try {
            await signIn("credentials", {
              email: formData.get("email"),
              password: formData.get("password"),
              redirectTo: callbackUrl ?? "/admin",
            });
          } catch (err) {
            if (err instanceof AuthError) {
              const params = new URLSearchParams({ error: "CredentialsSignin" });
              if (callbackUrl) params.set("callbackUrl", callbackUrl);
              redirect(`/login?${params.toString()}`);
            }
            throw err;
          }
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
