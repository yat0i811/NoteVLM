"use client";

import type { DocumentSummary } from "@/lib/api";
import clsx from "classnames";

interface DocumentListProps {
  documents: DocumentSummary[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
}

export default function DocumentList({ documents, selectedId, onSelect, onDelete }: DocumentListProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/80 p-5 shadow-sm backdrop-blur">
      <h2 className="text-sm font-semibold text-slate-700">Documents</h2>
      <div className="mt-3 space-y-2">
        {documents.length === 0 && <p className="text-xs text-slate-400">No generated documents yet.</p>}
        {documents.map((doc) => (
          <button
            key={doc.id}
            className={clsx(
              "w-full rounded-xl border px-4 py-3 text-left text-xs transition focus:outline-none",
              selectedId === doc.id
                ? "border-slate-900 bg-slate-900/5 text-slate-900"
                : "border-slate-200/70 bg-white/70 text-slate-500 hover:border-slate-300 hover:text-slate-700"
            )}
            onClick={() => onSelect(doc.id)}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium capitalize">{doc.title || "Untitled"}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                {doc.format}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
              <span>{new Date(doc.updated_at).toLocaleString()}</span>
              <span
                className="cursor-pointer text-red-400 hover:text-red-500"
                onClick={(event) => {
                  event.stopPropagation();
                  void onDelete(doc.id);
                }}
              >
                Delete
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
