import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// ============================================================
// /api/health (P12, section 37) - minimal, ne révèle AUCUNE donnée
// sensible (pas de version détaillée, pas de config, pas de secret).
// ============================================================

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
