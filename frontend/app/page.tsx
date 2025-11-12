"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import clsx from "classnames";
import Header from "@/components/Header";
import NotesTimeline from "@/components/NotesTimeline";
import DocumentEditor from "@/components/DocumentEditor";
import FilePreview from "@/components/FilePreview";
import type {
  DocumentDetail,
  DocumentSummary,
  LayoutDocument,
  ModelInfo,
  UpdateDocumentPayload,
  Upload
} from "@/lib/api";
import {
  deleteDocument,
  deleteUpload,
  digitalizeUpload,
  fetchDocument,
  fetcher,
  updateDocument,
  uploadFile
} from "@/lib/api";

export default function HomePage() {
  const { data: uploads, mutate: mutateUploads } = useSWR<Upload[]>("/api/files", fetcher);
  const { data: documents, mutate: mutateDocuments } = useSWR<DocumentSummary[]>("/api/documents", fetcher);
  const { data: models } = useSWR<ModelInfo[]>("/api/models", fetcher);

  const [selectedDocumentId, setSelectedDocumentId] = useState<string | undefined>();
  const [activeDocument, setActiveDocument] = useState<DocumentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyUploadId, setBusyUploadId] = useState<string | undefined>();
  const [refreshingDocument, setRefreshingDocument] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState<string | undefined>();
  const [selectedUploadId, setSelectedUploadId] = useState<string | undefined>();
  const [progress, setProgress] = useState<Record<string, number>>({});
  const progressTimers = useRef<Record<string, NodeJS.Timeout>>({});
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [streamingDocId, setStreamingDocId] = useState<string | null>(null);

  useEffect(() => {
    if (!models || models.length === 0) {
      return;
    }
    const preferred = models.find((model) => model.is_default) ?? models[0];
    setSelectedModelId((prev) => prev ?? preferred.id);
  }, [models]);

  useEffect(() => {
    if (!uploads || uploads.length === 0) {
      setSelectedUploadId(undefined);
      return;
    }
    if (!selectedUploadId || !uploads.some((upload) => upload.id === selectedUploadId)) {
      setSelectedUploadId(uploads[0].id);
    }
  }, [uploads, selectedUploadId]);

  useEffect(() => {
    if (!documents || documents.length === 0) {
      if (selectedDocumentId) {
        setSelectedDocumentId(undefined);
      }
      setActiveDocument(null);
      return;
    }
    if (!selectedDocumentId) {
      return;
    }
    const stillExists = documents.some((doc) => doc.id === selectedDocumentId);
    if (!stillExists) {
      setSelectedDocumentId(undefined);
      setActiveDocument(null);
    }
  }, [documents, selectedDocumentId]);

  useEffect(() => {
    const load = async () => {
      if (!selectedDocumentId) {
        setActiveDocument(null);
        return;
      }
      setError(null);
      setRefreshingDocument(true);
      try {
        const doc = await fetchDocument(selectedDocumentId);
        setActiveDocument(doc);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setRefreshingDocument(false);
      }
    };

    void load();
  }, [selectedDocumentId]);

  useEffect(() => {
    const timers = progressTimers.current;
    return () => {
      Object.values(timers).forEach((timer) => clearInterval(timer));
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.innerWidth < 1024) {
      setSidebarOpen(false);
    }
  }, []);

  const handleUpload = async (file: File) => {
    setError(null);
    setStreamingDocId(null);
    const formData = new FormData();
    formData.append("file", file);
    try {
      await uploadFile(formData);
      await mutateUploads();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const updateProgress = (uploadId: string, value: number) => {
    setProgress((prev) => ({ ...prev, [uploadId]: value }));
  };

  const clearProgress = (uploadId: string) => {
    setProgress((prev) => {
      const next = { ...prev };
      delete next[uploadId];
      return next;
    });
    if (progressTimers.current[uploadId]) {
      clearInterval(progressTimers.current[uploadId]);
      delete progressTimers.current[uploadId];
    }
  };

  const handleDigitalize = async (uploadId: string, format: "markdown" | "latex" | "layout") => {
    setError(null);
    setBusyUploadId(uploadId);
    updateProgress(uploadId, 5);
    if (progressTimers.current[uploadId]) {
      clearInterval(progressTimers.current[uploadId]);
    }
    progressTimers.current[uploadId] = setInterval(() => {
      setProgress((prev) => {
        const current = prev[uploadId] ?? 0;
        const next = Math.min(current + Math.random() * 8 + 4, 94);
        return { ...prev, [uploadId]: next };
      });
    }, 300);

    try {
      const docs = await digitalizeUpload(uploadId, {
        target_format: format,
        model: selectedModelId
      });
      if (!docs || docs.length === 0) {
        throw new Error("Digitalization produced no content");
      }
      await Promise.all([mutateUploads(), mutateDocuments()]);
      setSelectedUploadId(uploadId);
      const primaryDoc = docs[0];
      setStreamingDocId(primaryDoc.id);
      setSelectedDocumentId(primaryDoc.id);
      setActiveDocument(primaryDoc);
      updateProgress(uploadId, 100);
      setTimeout(() => clearProgress(uploadId), 600);
    } catch (err) {
      setError((err as Error).message);
      clearProgress(uploadId);
    } finally {
      setBusyUploadId(undefined);
      if (progressTimers.current[uploadId]) {
        clearInterval(progressTimers.current[uploadId]);
        delete progressTimers.current[uploadId];
      }
    }
  };

  const handleDeleteUpload = async (uploadId: string) => {
    try {
      await deleteUpload(uploadId);
      await Promise.all([mutateUploads(), mutateDocuments()]);
      if (activeDocument?.upload_id === uploadId) {
        setActiveDocument(null);
        setSelectedDocumentId(undefined);
      }
      clearProgress(uploadId);
      if (activeDocument?.upload_id === uploadId) {
        setStreamingDocId(null);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleSelectConversation = (uploadId: string, docId?: string) => {
    setSelectedUploadId(uploadId);
    setStreamingDocId(null);
    if (!docId) {
      setSelectedDocumentId(undefined);
      setActiveDocument(null);
      return;
    }
    setSelectedDocumentId(docId);
  };

  const handleDeleteDocument = async (docId: string) => {
    if (!docId) return;
    const targetSummary = documents?.find((doc) => doc.id === docId);
    const wasSelected = selectedDocumentId === docId;
    try {
      await deleteDocument(docId);
      const [updatedDocs] = await Promise.all([mutateDocuments(), mutateUploads()]);
      if (wasSelected) {
        setActiveDocument(null);
      }
      setStreamingDocId(null);
      if (targetSummary && wasSelected) {
        const siblings =
          (updatedDocs ?? [])
            .filter((doc) => doc.upload_id === targetSummary.upload_id && doc.id !== docId)
            .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
        if (siblings.length > 0) {
          const nextDoc = siblings[0];
          setSelectedUploadId(targetSummary.upload_id);
          setSelectedDocumentId(nextDoc.id);
          return;
        }
        setSelectedUploadId(targetSummary.upload_id);
      }
      if (wasSelected) {
        setSelectedDocumentId(undefined);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleSaveDocument = async ({
    id,
    title,
    content,
    layout
  }: {
    id: string;
    title?: string;
    content?: string;
    layout?: LayoutDocument | null;
  }) => {
    try {
  const payload: UpdateDocumentPayload = {};
      if (typeof title === "string") {
        payload.title = title;
      }
      if (typeof content === "string") {
        payload.content = content;
      }
      if (layout) {
        payload.layout = layout;
      }

      const doc = await updateDocument(id, payload);
      await mutateDocuments();
      setActiveDocument(doc);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const sortedUploads = useMemo(() => {
    if (!uploads) return [];
    return [...uploads].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [uploads]);

  const selectedUpload = useMemo(() => {
    if (!uploads || !selectedUploadId) return null;
    return uploads.find((upload) => upload.id === selectedUploadId) ?? null;
  }, [uploads, selectedUploadId]);

  return (
    <div className="flex min-h-screen bg-canvas text-slate-900">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/30 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-40 flex w-80 flex-col border-r border-slate-200 bg-white/95 shadow-lg transition-transform duration-200 ease-in-out lg:static lg:z-auto lg:h-auto lg:overflow-hidden lg:border-slate-200 lg:bg-white/90 lg:shadow-none",
          sidebarOpen
            ? "translate-x-0 lg:w-80 xl:w-96 lg:pointer-events-auto"
            : "-translate-x-full lg:translate-x-0 lg:w-0 lg:border-transparent lg:pointer-events-none"
        )}
      >
        <button
          type="button"
          onClick={() => setSidebarOpen((prev) => !prev)}
          className="flex h-16 items-center border-b border-slate-200 px-5 text-left transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300"
        >
          <div>
            <h1 className="text-base font-semibold text-primary">NoteVLM</h1>
          </div>
        </button>
        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-6">
          <NotesTimeline
            uploads={sortedUploads}
            onUpload={handleUpload}
            onRequestConversion={handleDigitalize}
            onDeleteUpload={handleDeleteUpload}
            onDeleteDocument={handleDeleteDocument}
            busyId={busyUploadId}
            models={models ?? []}
            selectedModel={selectedModelId}
            onModelChange={setSelectedModelId}
            selectedUploadId={selectedUploadId}
            selectedDocumentId={selectedDocumentId}
            onSelectConversation={handleSelectConversation}
            progress={progress}
          />
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <Header onToggleSidebar={() => setSidebarOpen((prev) => !prev)} />
        <main className="flex-1 overflow-y-auto px-4 pb-12 pt-8 sm:px-6 lg:px-10">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</div>
            )}

            <div className="space-y-6 lg:hidden">
              <NotesTimeline
                uploads={sortedUploads}
                onUpload={handleUpload}
                onRequestConversion={handleDigitalize}
                onDeleteUpload={handleDeleteUpload}
                onDeleteDocument={handleDeleteDocument}
                busyId={busyUploadId}
                models={models ?? []}
                selectedModel={selectedModelId}
                onModelChange={setSelectedModelId}
                selectedUploadId={selectedUploadId}
                selectedDocumentId={selectedDocumentId}
                onSelectConversation={handleSelectConversation}
                progress={progress}
              />
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <FilePreview upload={selectedUpload} document={activeDocument} />
              <DocumentEditor
                document={activeDocument}
                onSave={handleSaveDocument}
                refreshing={refreshingDocument}
                streamingDocId={streamingDocId ?? undefined}
                onStreamComplete={() => setStreamingDocId(null)}
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
