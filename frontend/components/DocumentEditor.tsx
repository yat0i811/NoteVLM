"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DependencyList } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

import { downloadUrl } from "@/lib/api";
import type { DocumentDetail, LayoutDocument, LayoutPage } from "@/lib/api";
import { prepareLatexForPreview } from "@/lib/latexPreview";

const AUTOSAVE_DELAY_MS = 600;
const EMPTY_PREVIEW = <p className="text-sm text-slate-400">Nothing to preview yet.</p>;

function useAutosave({
  enabled,
  hasChanges,
  onSave,
  deps
}: {
  enabled: boolean;
  hasChanges: boolean;
  onSave: () => Promise<void>;
  deps: DependencyList;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const depsSignature = JSON.stringify(deps);

  useEffect(() => {
    if (!enabled || !hasChanges) {
      return;
    }

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(async () => {
      try {
        await onSave();
      } finally {
        timerRef.current = null;
      }
    }, AUTOSAVE_DELAY_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, hasChanges, onSave, depsSignature]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);
}

function normalizeAlignEnvironments(text: string): string {
  return text.replace(/\\begin{align\*?}([\s\S]*?)\\end{align\*?}/g, (_match, body: string) => {
    const cleaned = body.trim().replace(/\\\\\s*(?=\S)/g, "\\\\\n");
    return `\n\n$$\n\\begin{aligned}\n${cleaned}\n\\end{aligned}\n$$\n\n`;
  });
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```") || trimmed === "```") {
    return value;
  }

  const lines = trimmed.split(/\r?\n/);
  if (lines[0]?.startsWith("```") ) {
    lines.shift();
  }
  if (lines.at(-1)?.trim() === "```") {
    lines.pop();
  }

  return lines.join("\n");
}

function renderMarkdownContent(source: string): JSX.Element {
  return (
    <ReactMarkdown
      className="markdown-body"
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[[rehypeKatex, { strict: false, trust: true, throwOnError: false }]]}
    >
      {source}
    </ReactMarkdown>
  );
}

function cloneLayoutDocument(source: LayoutDocument | null | undefined): LayoutDocument | null {
  return source ? JSON.parse(JSON.stringify(source)) : null;
}

interface DocumentEditorProps {
  document: DocumentDetail | null;
  onSave: (payload: { id: string; title?: string; content?: string; layout?: LayoutDocument }) => Promise<void>;
  refreshing: boolean;
  streamingDocId?: string | null;
  onStreamComplete?: () => void;
}

interface LoadedDocumentEditorProps extends Omit<DocumentEditorProps, "document"> {
  document: DocumentDetail;
}

export default function DocumentEditor(props: DocumentEditorProps) {
  const { document } = props;

  if (!document) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/60">
        <p className="text-sm text-slate-400">Select or create a document to get started.</p>
      </div>
    );
  }

  if (document.format === "layout") {
    return <LayoutModeEditor {...props} document={document} />;
  }

  return <TextModeEditor {...props} document={document} />;
}

function TextModeEditor({
  document,
  onSave,
  streamingDocId,
  onStreamComplete
}: LoadedDocumentEditorProps) {
  const [title, setTitle] = useState(document.title ?? "");
  const [content, setContent] = useState(document.content ?? "");
  const [viewMode, setViewMode] = useState<"edit" | "preview">("edit");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const streamingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousDocumentIdRef = useRef<string | null>(null);
  const lastSavedRef = useRef<{ docId: string; title: string; content: string }>({
    docId: document.id,
    title: document.title ?? "",
    content: document.content ?? ""
  });

  const stopStreaming = useCallback(() => {
    if (streamingTimerRef.current) {
      clearTimeout(streamingTimerRef.current);
      streamingTimerRef.current = null;
    }
  }, []);

  const startStreaming = useCallback(
    (text: string) => {
      stopStreaming();

      const tokens = text.match(/\s+|\S+/g) ?? [];
      if (tokens.length === 0) {
        setContent("");
        setIsStreaming(false);
        onStreamComplete?.();
        return;
      }

      setContent("");
      setIsStreaming(true);
      setViewMode("preview");

      let index = 0;

      const pushNext = () => {
        setContent((prev) => prev + tokens[index]);
        index += 1;

        if (index < tokens.length) {
          const delay = tokens[index - 1].trim() === "" ? 18 : 48;
          streamingTimerRef.current = setTimeout(pushNext, delay);
        } else {
          setIsStreaming(false);
          onStreamComplete?.();
        }
      };

      pushNext();
    },
    [onStreamComplete, stopStreaming]
  );

  useEffect(() => stopStreaming, [stopStreaming]);

  useEffect(() => {
    setTitle(document.title ?? "");

    if (document.id === streamingDocId && document.content) {
      startStreaming(document.content);
      previousDocumentIdRef.current = document.id;
      return;
    }

    stopStreaming();
    setIsStreaming(false);
    setContent(document.content ?? "");

    if (previousDocumentIdRef.current !== document.id) {
      setViewMode("edit");
    }

    previousDocumentIdRef.current = document.id;
    lastSavedRef.current = {
      docId: document.id,
      title: document.title ?? "",
      content: document.content ?? ""
    };
  }, [document, streamingDocId, startStreaming, stopStreaming]);

  const hasPendingChanges = useMemo(() => {
    return (
      title !== lastSavedRef.current.title ||
      content !== lastSavedRef.current.content ||
      document.id !== lastSavedRef.current.docId
    );
  }, [title, content, document.id]);

  const persistDraft = useCallback(async () => {
    setIsSaving(true);
    try {
      await onSave({ id: document.id, title, content });
      lastSavedRef.current = { docId: document.id, title, content };
    } finally {
      setIsSaving(false);
    }
  }, [content, document.id, onSave, title]);

  useAutosave({
    enabled: !isStreaming,
    hasChanges: hasPendingChanges,
    onSave: persistDraft,
    deps: [document.id]
  });

  const previewContent = useMemo(() => {
    if (!content.trim()) {
      return EMPTY_PREVIEW;
    }
    if (document.format === "markdown") {
      return renderMarkdownContent(normalizeAlignEnvironments(content));
    }
    if (document.format === "latex") {
      const stripped = stripCodeFence(content);
      const prepared = normalizeAlignEnvironments(prepareLatexForPreview(stripped));
      return prepared.trim() ? renderMarkdownContent(prepared) : EMPTY_PREVIEW;
    }
    return <pre className="whitespace-pre-wrap text-sm text-slate-600">{content}</pre>;
  }, [content, document.format]);

  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white/80 shadow-sm backdrop-blur">
      <div className="flex flex-col gap-4 border-b border-slate-200 p-5 md:flex-row md:items-center md:justify-between">
        <div className="flex w-full flex-col gap-2 md:max-w-sm">
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700 focus:outline-none"
            disabled={isStreaming}
          />
          <span className="text-xs text-slate-400">
            Format: {document.format.toUpperCase()}
            {isStreaming && <span className="ml-2 text-accent">生成中...</span>}
            {isSaving && !isStreaming && <span className="ml-2 text-slate-500">保存中...</span>}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
          <div className="flex rounded-full border border-slate-200 bg-slate-50 p-0.5 text-xs">
            <button
              className={`rounded-full px-3 py-1 font-medium transition ${
                viewMode === "edit" ? "bg-white text-slate-700 shadow" : "text-slate-500"
              }`}
              onClick={() => setViewMode("edit")}
              disabled={isStreaming}
            >
              Edit
            </button>
            <button
              className={`rounded-full px-3 py-1 font-medium transition ${
                viewMode === "preview" ? "bg-white text-slate-700 shadow" : "text-slate-500"
              }`}
              onClick={() => setViewMode("preview")}
            >
              Preview
            </button>
          </div>
        </div>
      </div>
      {viewMode === "edit" ? (
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          className="grow resize-none bg-transparent p-5 text-sm text-slate-700 focus:outline-none"
          placeholder="Generated content will appear here..."
          disabled={isStreaming}
        />
      ) : (
        <div className="max-w-none grow overflow-y-auto bg-slate-50 p-5 text-slate-700">{previewContent}</div>
      )}
    </div>
  );
}

function LayoutModeEditor({ document, onSave }: LoadedDocumentEditorProps) {
  const [title, setTitle] = useState(document.title ?? "");
  const [layout, setLayout] = useState<LayoutDocument | null>(cloneLayoutDocument(document.layout));
  const [viewMode, setViewMode] = useState<"edit" | "preview">("edit");
  const [pageIndex, setPageIndex] = useState<number>(document.layout?.pages[0]?.index ?? 1);
  const [isSaving, setIsSaving] = useState(false);

  const lastSavedRef = useRef<{ title: string; layout: string }>({
    title: document.title ?? "",
    layout: JSON.stringify(document.layout ?? { pages: [] })
  });

  useEffect(() => {
    const snapshot = cloneLayoutDocument(document.layout);
    setTitle(document.title ?? "");
    setLayout(snapshot);
    setPageIndex(snapshot?.pages[0]?.index ?? 1);
    lastSavedRef.current = {
      title: document.title ?? "",
      layout: JSON.stringify(snapshot ?? { pages: [] })
    };
  }, [document.id, document.layout, document.title]);

  const serializedLayout = useMemo(() => JSON.stringify(layout ?? { pages: [] }), [layout]);

  const persistLayout = useCallback(async () => {
    if (!layout) {
      return;
    }
    setIsSaving(true);
    try {
      await onSave({ id: document.id, title, layout });
      lastSavedRef.current = { title, layout: serializedLayout };
    } finally {
      setIsSaving(false);
    }
  }, [document.id, layout, onSave, serializedLayout, title]);

  const hasPendingChanges = useMemo(() => {
    return (
      !!layout && (
        title !== lastSavedRef.current.title ||
        serializedLayout !== lastSavedRef.current.layout
      )
    );
  }, [layout, serializedLayout, title]);

  useAutosave({
    enabled: !!layout,
    hasChanges: hasPendingChanges,
    onSave: persistLayout,
    deps: [document.id, serializedLayout]
  });

  const pages = useMemo(() => layout?.pages ?? [], [layout]);
  const currentPage: LayoutPage | undefined = useMemo(() => {
    if (pages.length === 0) {
      return undefined;
    }
    return pages.find((page) => page.index === pageIndex) ?? pages[0];
  }, [pages, pageIndex]);

  const currentPageText = currentPage?.text ?? "";

  const backgroundImageUrl = useMemo(() => {
    const source = currentPage?.image?.url;
    if (!source) {
      return null;
    }
    return downloadUrl(source);
  }, [currentPage?.image?.url]);

  const previewBackgroundStyle = useMemo(() => {
    if (!backgroundImageUrl) {
      return undefined;
    }
    return {
      backgroundImage: `url(${backgroundImageUrl})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat"
    } as const;
  }, [backgroundImageUrl]);

  const pagePreviewContent = useMemo(() => {
    if (!currentPageText.trim()) {
      return EMPTY_PREVIEW;
    }
    return renderMarkdownContent(normalizeAlignEnvironments(currentPageText));
  }, [currentPageText]);

  const updatePageText = useCallback(
    (value: string) => {
      setLayout((previous) => {
        if (!previous) {
          return previous;
        }
        return {
          ...previous,
          pages: previous.pages.map((page) =>
            page.index === currentPage?.index ? { ...page, text: value } : page
          )
        };
      });
    },
    [currentPage?.index]
  );

  const handlePageSelect = useCallback((index: number) => {
    setViewMode("edit");
    setPageIndex(index);
  }, []);

  if (!layout || pages.length === 0 || !currentPage) {
    return (
      <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white/80 p-5 shadow-sm backdrop-blur">
        <h2 className="text-sm font-semibold text-slate-700">Layout Document</h2>
        <p className="mt-4 text-sm text-slate-500">レイアウト情報がまだ生成されていません。</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white/80 shadow-sm backdrop-blur">
      <div className="flex flex-col gap-4 border-b border-slate-200 p-5 md:flex-row md:items-center md:justify-between">
        <div className="flex w-full flex-col gap-2 md:max-w-sm">
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700 focus:outline-none"
          />
          <span className="text-xs text-slate-400">
            Format: LAYOUT
            {isSaving && <span className="ml-2 text-slate-500">保存中...</span>}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex rounded-full border border-slate-200 bg-slate-50 p-0.5 text-xs">
            <button
              className={`rounded-full px-3 py-1 font-medium transition ${
                viewMode === "edit" ? "bg-white text-slate-700 shadow" : "text-slate-500"
              }`}
              onClick={() => setViewMode("edit")}
            >
              Edit
            </button>
            <button
              className={`rounded-full px-3 py-1 font-medium transition ${
                viewMode === "preview" ? "bg-white text-slate-700 shadow" : "text-slate-500"
              }`}
              onClick={() => setViewMode("preview")}
            >
              Preview
            </button>
          </div>
        </div>
      </div>

      <div className="border-b border-slate-200 bg-slate-50 px-5 py-3">
        <div className="flex flex-wrap gap-2">
          {pages.map((page) => (
            <button
              key={page.index}
              type="button"
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                page.index === currentPage.index
                  ? "bg-primary text-white shadow"
                  : "border border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-800"
              }`}
              onClick={() => handlePageSelect(page.index)}
            >
              Page {page.index}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {viewMode === "edit" ? (
          <textarea
            value={currentPageText}
            onChange={(event) => updatePageText(event.target.value)}
            className="min-h-[360px] xl:min-h-[600px] w-full grow resize-none rounded-xl border border-slate-200 bg-white/80 p-4 text-sm text-slate-700 shadow-inner focus:outline-none"
            placeholder="OCRで取得した内容が表示されます。誤りがあれば修正してください。"
          />
        ) : (
          <div className="flex flex-col gap-4">
            <div
              className="relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 shadow-sm"
              style={previewBackgroundStyle}
            >
              {backgroundImageUrl && (
                <div className="absolute inset-0 bg-white/85 backdrop-blur-[8px]" aria-hidden />
              )}
              <div className="relative border-b border-slate-300/40 px-4 py-3 text-xs font-medium uppercase tracking-wide text-slate-700 shadow-sm">
                抽出テキストプレビュー
              </div>
              <div className="relative max-h-[620px] xl:max-h-[800px] overflow-auto p-5 text-sm leading-relaxed text-slate-900">
                {pagePreviewContent}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
