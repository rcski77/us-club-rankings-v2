"use server";

import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { mergeClubsIntoTarget } from "@/lib/club/mergeClubs";

export async function updateClub(clubId: string, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const regionId = String(formData.get("regionId") ?? "") || null;
  const externalCode = String(formData.get("externalCode") ?? "").trim() || null;
  const city = String(formData.get("city") ?? "").trim() || null;
  const state = String(formData.get("state") ?? "").trim() || null;
  const zip = String(formData.get("zip") ?? "").trim() || null;
  const isActive = formData.get("isActive") === "on";

  if (!name) {
    redirect(`/admin/clubs/${clubId}?error=invalid`);
  }

  await prisma.club.update({
    where: { id: clubId },
    data: { name, regionId, externalCode, city, state, zip, isActive },
  });

  revalidatePath(`/admin/clubs/${clubId}`);
  revalidatePath("/admin/clubs");
  redirect(`/admin/clubs/${clubId}?success=1`);
}

export async function mergeIntoThisClub(clubId: string, formData: FormData) {
  const sourceClubIds = formData.getAll("sourceClubIds").map(String).filter(Boolean);

  if (sourceClubIds.length === 0) {
    redirect(`/admin/clubs/${clubId}?error=no_source_selected`);
  }

  let result;
  try {
    result = await mergeClubsIntoTarget(clubId, sourceClubIds);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Merge failed.";
    redirect(`/admin/clubs/${clubId}?error=merge_failed&mergeError=${encodeURIComponent(message)}`);
  }

  revalidatePath(`/admin/clubs/${clubId}`);
  revalidatePath("/admin/clubs");

  const params = new URLSearchParams({
    success: "merged",
    teamsMoved: String(result.teamsMoved),
    conflicts: String(result.conflicts.length),
  });
  redirect(`/admin/clubs/${clubId}?${params.toString()}`);
}
