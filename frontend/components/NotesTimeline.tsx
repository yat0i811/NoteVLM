"use client";

import { useMemo, useState, DragEvent } from "react";
import type { ReactNode } from "react";
import type { ModelInfo, Upload } from "@/lib/api";
import { downloadUrl } from "@/lib/api";

interface NotesTimelineProps {
  uploads: Upload[];
  onUpload: (file: File) => Promise<void>;
  onRequestConversion: (uploadId: string, format: "markdown" | "latex" | "layout") => Promise<void>;
  onDeleteUpload: (uploadId: string) => Promise<void>;
  onDeleteDocument: (documentId: string) => Promise<void>;
  busyId?: string;
  models: ModelInfo[];
  selectedModel?: string;
  onModelChange: (modelId: string) => void;
  selectedUploadId?: string;
  selectedDocumentId?: string;
  onSelectConversation: (uploadId: string, documentId?: string) => void;
  progress?: Record<string, number>;
}

export default function NotesTimeline({
  uploads,
  onUpload,
  onRequestConversion,
  onDeleteUpload,
  onDeleteDocument,
  busyId,
  models,
  selectedModel,
  onModelChange,
  selectedUploadId,
  selectedDocumentId,
  onSelectConversation,
  progress
}: NotesTimelineProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    await onUpload(files[0]);
  };

  const onDrop = async (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
    await handleFiles(event.dataTransfer.files);
  };

  const sortedThreads = useMemo(() => {
    return [...uploads].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [uploads]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white/80 p-5 shadow-sm backdrop-blur">
        <label
          htmlFor="file-upload"
          onDrop={onDrop}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-300 p-6 text-slate-600 transition ${
            isDragging ? "border-accent bg-sky-50 text-accent" : "hover:border-slate-200"
          }`}
        >
          <span className="text-sm font-semibold text-primary">Drop files or click to upload</span>
          <span className="text-xs text-slate-500">PDF, PNG, JPG, WebP, HEIC up to 20MB</span>
          <input
            id="file-upload"
            type="file"
            className="hidden"
            accept="application/pdf,image/*"
            onChange={(event) => handleFiles(event.target.files)}
          />
        </label>
        <div className="mt-4 flex flex-col gap-2">
          <label htmlFor="model-select" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Model
          </label>
          <select
            id="model-select"
            value={selectedModel ?? ""}
            onChange={(event) => onModelChange(event.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-slate-400 focus:outline-none"
            disabled={models.length === 0}
          >
            {models.length === 0 && <option value="">Loading...</option>}
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.id}
                {model.is_default ? " (default)" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-slate-700">Notes</h2>
        {sortedThreads.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white/80 p-5 text-sm text-slate-500 shadow-sm">
            まだノートはありません。ファイルをアップロードしてデジタル化を始めましょう。
          </div>
        )}
        {sortedThreads.map((upload) => {
          const percent = progress?.[upload.id] ?? 0;
          const documents = [...upload.documents].sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
          const threadSelected = selectedUploadId === upload.id;
          const documentSelected = documents.find((doc) => doc.id === selectedDocumentId);
          return (
            <div
              key={upload.id}
              className={`rounded-2xl border bg-white/80 p-4 shadow-sm transition ${
                threadSelected ? "border-slate-900" : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-primary">{upload.original_name}</p>
                  <p className="text-xs text-slate-500">
                    {(upload.size / 1024).toFixed(1)} KB · {new Date(upload.created_at).toLocaleString()}
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded-full px-2 py-1 text-xs font-medium text-red-500 transition hover:bg-red-50"
                  onClick={(event) => {
                    event.stopPropagation();
                    void onDeleteUpload(upload.id);
                  }}
                  disabled={busyId === upload.id}
                >
                  削除
                </button>
              </div>

              <div className="mt-3 space-y-3">
                <TimelineCard
                  label="アップロードファイル"
                  active={threadSelected && !selectedDocumentId}
                  onSelect={() => onSelectConversation(upload.id, undefined)}
                  progress={percent}
                >
                  <div className="space-y-2">
                    <div className="text-sm text-slate-600">{upload.original_name}</div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-800 disabled:opacity-50"
                        onClick={(event) => {
                          event.stopPropagation();
                          void onRequestConversion(upload.id, "markdown");
                        }}
                        disabled={busyId === upload.id || !selectedModel}
                      >
                        {busyId === upload.id ? "変換中..." : "Markdown"}
                      </button>
                      <button
                        type="button"
                        className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-800 disabled:opacity-50"
                        onClick={(event) => {
                          event.stopPropagation();
                          void onRequestConversion(upload.id, "latex");
                        }}
                        disabled={busyId === upload.id || !selectedModel}
                      >
                        {busyId === upload.id ? "変換中..." : "LaTeX"}
                      </button>
                      <button
                        type="button"
                        className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-800 disabled:opacity-50"
                        onClick={(event) => {
                          event.stopPropagation();
                          void onRequestConversion(upload.id, "layout");
                        }}
                        disabled={busyId === upload.id || !selectedModel}
                      >
                        {busyId === upload.id ? "変換中..." : "Layout"}
                      </button>
                      <a
                        className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
                        href={downloadUrl(`/api/files/${upload.id}`)}
                        target="_blank"
                        rel="noopener noreferrer"
                        download={upload.original_name}
                        onClick={(event) => event.stopPropagation()}
                      >
                        ダウンロード
                      </a>
                    </div>
                  </div>
                </TimelineCard>

                {documents.map((doc) => {
                  const noteLabel =
                    doc.format === "markdown" ? "Markdown" : doc.format === "latex" ? "LaTeX" : "Layout";
                  return (
                    <TimelineCard
                    key={doc.id}
                    label={noteLabel}
                    active={documentSelected?.id === doc.id}
                    onSelect={() => onSelectConversation(upload.id, doc.id)}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-primary">{doc.title || "Untitled"}</span>
                        <span>{new Date(doc.updated_at).toLocaleString()}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <a
                          className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
                          href={downloadUrl(`/api/documents/${doc.id}/download`)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(event) => event.stopPropagation()}
                        >
                          ダウンロード
                        </a>
                        <button
                          type="button"
                          className="rounded-full px-3 py-1 text-xs font-medium text-red-500 transition hover:bg-red-50"
                          onClick={(event) => {
                            event.stopPropagation();
                            void onDeleteDocument(doc.id);
                          }}
                          disabled={busyId === upload.id}
                        >
                          削除
                        </button>
                      </div>
                    </div>
                  </TimelineCard>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface TimelineCardProps {
  label: string;
  active: boolean;
  onSelect: () => void;
  children: ReactNode;
  progress?: number;
}

function TimelineCard({ label, active, onSelect, children, progress }: TimelineCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={`w-full rounded-2xl border px-4 py-3 text-left shadow-sm transition ${
        active ? "border-slate-900 bg-slate-900/5" : "border-slate-200 bg-white/70 hover:border-slate-300"
      }`}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</p>
        {progress !== undefined && progress > 0 && progress < 100 && (
          <span className="text-xs font-medium text-accent">{Math.round(progress)}%</span>
        )}
      </div>
      <div className="mt-3 space-y-3">{children}</div>
      {progress !== undefined && progress > 0 && (
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
