"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { inputClass } from "@/lib/ui";

type TeamResult = { id: string; name: string; ageGroup: number | null };

export function TeamCombobox({
  divisionId,
  searchAction,
  fieldName,
}: {
  divisionId: string;
  searchAction: (divisionId: string, query: string) => Promise<TeamResult[]>;
  fieldName: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TeamResult[]>([]);
  const [selected, setSelected] = useState<TeamResult | null>(null);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleChange(value: string) {
    setQuery(value);
    setSelected(null);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const teams = await searchAction(divisionId, value);
        setResults(teams);
      });
    }, 250);
  }

  function handleSelect(team: TeamResult) {
    setSelected(team);
    setQuery(`${team.name}${team.ageGroup ? ` (${team.ageGroup}u)` : ""}`);
    setResults([]);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative flex flex-col gap-1 text-sm">
      Team
      <input
        type="text"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder="Search teams…"
        autoComplete="off"
        className={`${inputClass} w-64`}
      />
      <input type="hidden" name={fieldName} value={selected?.id ?? ""} required />
      {open && query.trim().length >= 2 && (
        <ul className="absolute top-full z-10 mt-1 max-h-64 w-64 overflow-auto rounded border bg-white text-sm shadow-md">
          {isPending && <li className="px-3 py-2 text-slate-500">Searching…</li>}
          {!isPending && results.length === 0 && (
            <li className="px-3 py-2 text-slate-500">No matching teams.</li>
          )}
          {!isPending &&
            results.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => handleSelect(t)}
                  className="block w-full px-3 py-2 text-left hover:bg-slate-100"
                >
                  {t.name}
                  {t.ageGroup ? ` (${t.ageGroup}u)` : ""}
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
