import { auth } from "@/auth";
import { redirect } from "next/navigation";

// ADMIN can create/update everything but not delete -- only SUPER_ADMIN can.
// Call at the top of any server action that performs a delete, before touching
// Prisma. Follows the project's redirect+?error=<code> convention rather than
// throwing, so the page can render a banner (see admin/CLAUDE.md).
export async function requireSuperAdmin(redirectPath: string) {
  const session = await auth();
  if (session?.user.role !== "SUPER_ADMIN") {
    redirect(`${redirectPath}?error=forbidden`);
  }
}
