"use server";

import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { removeFromRankingGroup } from "@/lib/club/combineClubsForRankings";

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

export async function leaveRankingGroup(clubId: string) {
  await removeFromRankingGroup(clubId);
  revalidatePath(`/admin/clubs/${clubId}`);
  revalidatePath("/admin/clubs");
  revalidatePath("/admin/club-groups");
  redirect(`/admin/clubs/${clubId}?success=removed_from_group`);
}
