"use client";

import { useState } from "react";
import { dangerButtonClass, inputClass, secondaryButtonClass, smallDangerButtonClass } from "@/lib/ui";

export default function DeleteEventButton({
  action,
  eventName,
  divisionCount,
  finishCount,
}: {
  action: () => void;
  eventName: string;
  divisionCount: number;
  finishCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const matches = confirmText === eventName;

  return (
    <>
      <button type="button" className={smallDangerButtonClass} onClick={() => setOpen(true)}>
        Delete event
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded bg-white p-5 shadow-lg">
            <h3 className="mb-2 text-lg font-medium text-red-700">Delete event</h3>
            <p className="mb-3 text-sm text-slate-600">
              This permanently removes <span className="font-medium">{eventName}</span>,
              its {divisionCount} division(s), and {finishCount} team finish(es). This
              cannot be undone.
            </p>
            <label className="mb-1 block text-sm">
              Type the event name to confirm:
            </label>
            <p className="mb-2 rounded bg-slate-100 px-2 py-1 font-mono text-xs">{eventName}</p>
            <input
              autoFocus
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={eventName}
              className={`${inputClass} mb-4 w-full`}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={() => {
                  setOpen(false);
                  setConfirmText("");
                }}
              >
                Cancel
              </button>
              <form action={action}>
                <button type="submit" disabled={!matches} className={dangerButtonClass}>
                  Delete event
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
