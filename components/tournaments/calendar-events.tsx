"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiRequest } from "@/lib/api";
import { calendarCell, displayEventTime } from "@/lib/tournaments/dates";
import { statusNames, type Tournament } from "@/lib/tournaments/types";

export function useCalendarTournaments(weekKey: string, userId: string | null) {
  const [snapshot, setSnapshot] = useState<{ week: string; user: string; items: Tournament[] }>({ week: "", user: "", items: [] });
  const [error, setError] = useState(false); const [generation, setGeneration] = useState(0);
  const refresh = useCallback(() => setGeneration(value => value + 1), []);
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    const load = async () => {
      try {
        const items: Tournament[] = []; let offset: number | null = 0;
        while (offset !== null) {
          const page: { items: Tournament[]; nextOffset: number | null } = await apiRequest(`/api/tournaments?week=${weekKey}&offset=${offset}`, { signal: controller.signal });
          items.push(...page.items);
          if (page.nextOffset !== null && page.nextOffset <= offset) throw new Error("invalid pagination");
          offset = page.nextOffset;
        }
        if (!controller.signal.aborted) { setSnapshot({ week: weekKey, user: userId, items }); setError(false); }
      } catch { if (!controller.signal.aborted) setError(true); }
    };
    void load();
    return () => controller.abort();
  }, [weekKey, userId, generation]);
  return { tournaments: snapshot.week === weekKey && snapshot.user === userId ? snapshot.items : [], tournamentError: error, refreshTournaments: refresh };
}
export function CalendarTournamentEntries({ items, weekKey, day, slot }: { items: Tournament[]; weekKey: string; day: number; slot: number }) {
  return <>{items.filter(t => { const cell = calendarCell(t.starts_at, weekKey); return cell?.day === day && cell.slot === slot; }).map(t => <Link key={t.id} href={`/tournaments/${t.id}`} className="block min-h-11 break-words rounded-md border border-violet-200 bg-violet-50 p-2 text-left text-xs leading-5 text-violet-950 hover:bg-violet-100">
    <span className="font-bold">赛事 · {t.title}</span><span className="block">{slot === -1 && "预约时段外 · "}{displayEventTime(t.starts_at)} · {statusNames[t.status]}</span><span className="block">预报 {t.entry_count}/{t.capacity} · 报到 {t.checked_in_count}</span>
  </Link>)}</>;
}
