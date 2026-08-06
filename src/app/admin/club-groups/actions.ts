"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { mergeClubsIntoTarget } from "@/lib/club/mergeClubs";
import { combineClubsForRankings, removeFromRankingGroup } from "@/lib/club/combineClubsForRankings";

function revalidateClubPaths() {
  revalidatePath("/admin/club-groups");
  revalidatePath("/admin/clubs");
}

export async function mergeClubs(formData: FormData) {
  const targetClubId = String(formData.get("targetClubId") ?? "");
  const sourceClubIds = formData.getAll("sourceClubIds").map(String).filter(Boolean);

  if (!targetClubId) {
    redirect("/admin/club-groups?error=no_target");
  }
  if (sourceClubIds.length === 0) {
    redirect(`/admin/club-groups?mergeTargetId=${targetClubId}&error=no_source_selected`);
  }

  let result;
  try {
    result = await mergeClubsIntoTarget(targetClubId, sourceClubIds);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Merge failed.";
    redirect(
      `/admin/club-groups?mergeTargetId=${targetClubId}&error=merge_failed&mergeError=${encodeURIComponent(message)}`,
    );
  }

  revalidateClubPaths();
  const overridden = result.annualScoresOverridden + result.annualAgeGroupScoresOverridden;
  const params = new URLSearchParams({
    success: "merged",
    teamsMoved: String(result.teamsMoved),
    yearsResolved: String(result.yearResolutions.length),
    yearsOverridden: String(overridden),
  });
  redirect(`/admin/club-groups?${params.toString()}`);
}

export async function combineClubs(formData: FormData) {
  const primaryClubId = String(formData.get("primaryClubId") ?? "");
  const memberClubIds = formData.getAll("memberClubIds").map(String).filter(Boolean);

  if (!primaryClubId) {
    redirect("/admin/club-groups?error=no_primary");
  }
  if (memberClubIds.length === 0) {
    redirect(`/admin/club-groups?groupPrimaryId=${primaryClubId}&error=no_member_selected`);
  }

  let combinedCount: number;
  try {
    combinedCount = await combineClubsForRankings(primaryClubId, memberClubIds);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Combine failed.";
    redirect(
      `/admin/club-groups?groupPrimaryId=${primaryClubId}&error=combine_failed&combineError=${encodeURIComponent(message)}`,
    );
  }

  revalidateClubPaths();
  redirect(`/admin/club-groups?success=combined&clubsCombined=${combinedCount}`);
}

export async function removeGroupMember(formData: FormData) {
  const clubId = String(formData.get("clubId") ?? "");
  if (clubId) {
    await removeFromRankingGroup(clubId);
  }
  revalidateClubPaths();
  redirect("/admin/club-groups?success=removed_from_group");
}
