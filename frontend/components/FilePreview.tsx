"use client";

import { useEffect, useMemo, useState } from "react";
import type { DocumentDetail, Upload } from "@/lib/api";
import { downloadUrl } from "@/lib/api";

type PreviewSource = {
  key: string;
  previewUrl: string;
  downloadUrl: string;
  mime: string;
  name: string;
  hint: string;
  isZoomable: boolean;
};

interface FilePreviewProps {
  upload: Upload | null;
  document?: DocumentDetail | null;
}

export default function FilePreview({ upload, document }: FilePreviewProps) {
  const [zoom, setZoom] = useState(1);

  const handleZoom = (delta: number) => {
    setZoom((prev) => {
      const next = Math.min(3, Math.max(0.5, Number((prev + delta).toFixed(2))));
      return next;
    });
  };

  const resetZoom = () => setZoom(1);

  const source: PreviewSource | null = useMemo(() => {
    const withPreview = (path: string) => {
      const base = downloadUrl(path);
      return {
        previewUrl: `${base}${base.includes("?") ? "&" : "?"}preview=1`,
        downloadUrl: base
      };
    };

    const sourceFile = document?.source_file;
    if (document && sourceFile) {
      const urls = withPreview(sourceFile.download_url);
      const mime = sourceFile.mime_type ?? "";
      return {
        key: `document-${document.id}`,
        previewUrl: urls.previewUrl,
        downloadUrl: urls.downloadUrl,
        mime,
        name: sourceFile.name,
        hint: "Saved with document",
        isZoomable: mime.startsWith("image/") || mime === "application/pdf"
      };
    }
    if (upload) {
      const urls = withPreview(`/api/files/${upload.id}`);
      const mime = upload.mime_type ?? "";
      return {
        key: `upload-${upload.id}`,
        previewUrl: urls.previewUrl,
        downloadUrl: urls.downloadUrl,
        mime,
        name: upload.original_name,
        hint: "Uploaded source",
        isZoomable: mime.startsWith("image/") || mime === "application/pdf"
      };
    }
    return null;
  }, [upload, document]);

  useEffect(() => {
    setZoom(1);
  }, [source?.key]);

  const content = useMemo(() => {
    if (!source) {
      return <p className="text-sm text-slate-400">Select a document to see its original file.</p>;
    }
    if (source.mime.startsWith("image/")) {
      return (
        <div className="max-h-[480px] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-2">
          <img
            src={source.previewUrl}
            alt={source.name}
            className="block max-w-none"
            style={{ width: `${zoom * 100}%` }}
          />
        </div>
      );
    }

    if (source.mime === "application/pdf") {
      const zoomPercent = Math.round(zoom * 100);
      return (
        <iframe
          key={zoomPercent}
          src={`${source.previewUrl}#toolbar=0&zoom=${zoomPercent}`}
          title={source.name}
          className="h-[480px] w-full rounded-lg border border-slate-200"
        />
      );
    }

    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500 shadow-sm">
        Preview is not available for this file type. You can download the original file to view it.
      </div>
    );
  }, [source, zoom]);

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white/80 p-5 shadow-sm backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-700">アップロードファイル</h2>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {source?.isZoomable && (
            <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500 shadow-sm">
              <button
                type="button"
                onClick={() => handleZoom(-0.25)}
                className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 text-base leading-none transition hover:bg-slate-100"
              >
                -
              </button>
              <span className="min-w-[3ch] text-center">{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                onClick={() => handleZoom(0.25)}
                className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 text-base leading-none transition hover:bg-slate-100"
              >
                +
              </button>
              <button
                type="button"
                onClick={resetZoom}
                className="rounded-full border border-transparent px-2 py-0.5 text-[11px] font-medium text-accent hover:border-accent"
              >
                Reset
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="overflow-hidden rounded-xl bg-slate-50 p-3 shadow-inner" key={source?.key ?? "no-source"}>
        {content}
      </div>
    </div>
  );
}
