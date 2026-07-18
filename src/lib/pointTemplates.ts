import { prisma } from "@/lib/prisma";

/** Recomputes and persists PointTemplate.maxPoints from its current bands. */
export async function refreshMaxPoints(pointTemplateId: string) {
  const bands = await prisma.pointTemplateBand.findMany({ where: { pointTemplateId } });
  const maxPoints = bands.reduce((max, b) => Math.max(max, b.points), 0);
  await prisma.pointTemplate.update({ where: { id: pointTemplateId }, data: { maxPoints } });
}
