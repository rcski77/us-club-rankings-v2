import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Rankings" };

export default function RankingsIndexPage() {
  redirect("/rankings/events");
}
