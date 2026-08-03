"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { inputClass } from "@/lib/ui";

type Club = { id: string; name: string };

// Caps how many matches render as <option>-equivalents at once -- with ~9k clubs in
// the system, rendering every match on every keystroke would reintroduce the same
// DOM-weight problem this component exists to avoid.
const MAX_RESULTS = 50;

export function ClubCombobox({
  clubs,
  name,
  defaultClubId,
  placeholder = "Search to link a different club…",
}: {
  clubs: Club[];
  name: string;
  // Omit entirely for a brand-new record (no "currently linked" line makes sense yet).
  // Pass null for an existing record that's explicitly unlinked.
  defaultClubId?: string | null;
  placeholder?: string;
}) {
  const [selectedId, setSelectedId] = useState(defaultClubId ?? "");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const showCurrent = defaultClubId !== undefined;
  const currentClub = clubs.find((c) => c.id === defaultClubId) ?? null;
  const selectedClub = clubs.find((c) => c.id === selectedId) ?? null;
  const changed = selectedId !== (defaultClubId ?? "");

  const trimmed = query.trim().toLowerCase();
  const results = (
    trimmed === "" ? clubs : clubs.filter((c) => c.name.toLowerCase().includes(trimmed))
  ).slice(0, MAX_RESULTS);

  function openDropdown() {
    setQuery("");
    setOpen(true);
  }

  function select(club: Club | null) {
    setSelectedId(club?.id ?? "");
    setOpen(false);
  }

  return (
    <div className="flex flex-col gap-1">
      {showCurrent && (
        <div className="text-sm">
          Currently linked:{" "}
          {currentClub ? (
            <Link href={`/admin/clubs/${currentClub.id}`} className="text-slate-900 underline">
              {currentClub.name}
            </Link>
          ) : (
            <span className="text-slate-400">(unlinked)</span>
          )}
          {changed && (
            <span className="ml-2 text-amber-700">
              → {selectedClub ? selectedClub.name : "(unlinked)"} (unsaved)
            </span>
          )}
        </div>
      )}
      <div ref={rootRef} className="relative">
        <input type="hidden" name={name} value={selectedId} />
        <input
          type="text"
          className={inputClass}
          placeholder={placeholder}
          value={open ? query : ""}
          onFocus={openDropdown}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
        />
        {open && (
          <ul className="absolute z-10 mt-1 max-h-64 w-full min-w-64 overflow-auto rounded border bg-white shadow-md">
            <li>
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-sm text-slate-500 hover:bg-slate-100"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(null)}
              >
                (unlinked)
              </button>
            </li>
            {results.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-100"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => select(c)}
                >
                  {c.name}
                </button>
              </li>
            ))}
            {results.length === 0 && <li className="px-3 py-1.5 text-sm text-slate-400">No matches</li>}
          </ul>
        )}
      </div>
    </div>
  );
}
