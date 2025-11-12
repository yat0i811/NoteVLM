export type Upload = {
  id: string;
  original_name: string;
  mime_type: string;
  size: number;
  created_at: string;
  documents: DocumentSummary[];
};

export type DocumentSummary = {
  id: string;
  upload_id: string;
  title: string;
  format: "markdown" | "latex" | "layout";
  created_at: string;
  updated_at: string;
};

export type DocumentSourceFile = {
  name: string;
  mime_type: string;
  size: number;
  download_url: string;
};

export type LayoutImage = {
  url: string;
  width: number;
  height: number;
};

export type LayoutPage = {
  index: number;
  text: string;
  image: LayoutImage;
};

export type LayoutDocument = {
  version: number;
  pages: LayoutPage[];
};

export type DocumentDetail = DocumentSummary & {
  content: string;
  source_file?: DocumentSourceFile | null;
  layout?: LayoutDocument | null;
};

export type DigitalizePayload = {
  target_format: "markdown" | "latex" | "layout";
  title?: string;
  model?: string;
};

export type ModelInfo = {
  id: string;
  is_default: boolean;
};

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8003").replace(/\/$/, "");
const DOWNLOAD_BASE = (process.env.NEXT_PUBLIC_DOWNLOAD_URL ?? API_BASE).replace(/\/$/, "");

const jsonHeaders = {
  "Content-Type": "application/json"
};

export const fetcher = async (url: string) => {
  const res = await fetch(`${API_BASE}${url}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }
  return res.json();
};

export async function uploadFile(formData: FormData): Promise<Upload> {
  const res = await fetch(`${API_BASE}/api/files`, {
    method: "POST",
    body: formData
  });
  if (!res.ok) {
    throw new Error("Upload failed");
  }
  return res.json();
}

export async function deleteUpload(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/files/${id}`, {
    method: "DELETE"
  });
  if (!res.ok) {
    throw new Error("Delete failed");
  }
}

export async function digitalizeUpload(uploadId: string, payload: DigitalizePayload): Promise<DocumentDetail[]> {
  const res = await fetch(`${API_BASE}/api/files/${uploadId}/digitalize`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    const message = detail?.detail ?? "Digitalization failed";
    throw new Error(message);
  }
  return res.json();
}

export async function fetchDocument(documentId: string): Promise<DocumentDetail> {
  const res = await fetch(`${API_BASE}/api/documents/${documentId}`);
  if (!res.ok) {
    throw new Error("Document fetch failed");
  }
  return res.json();
}

export type UpdateDocumentPayload = {
  title?: string;
  content?: string;
  layout?: LayoutDocument;
};

export async function updateDocument(documentId: string, payload: UpdateDocumentPayload): Promise<DocumentDetail> {
  const res = await fetch(`${API_BASE}/api/documents/${documentId}`, {
    method: "PUT",
    headers: jsonHeaders,
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    throw new Error("Update failed");
  }
  return res.json();
}

export async function deleteDocument(documentId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/documents/${documentId}`, {
    method: "DELETE"
  });
  if (!res.ok) {
    throw new Error("Delete failed");
  }
}

export async function fetchModels(): Promise<ModelInfo[]> {
  const res = await fetch(`${API_BASE}/api/models`, {
    cache: "no-store"
  });
  if (!res.ok) {
    throw new Error("Model list fetch failed");
  }
  return res.json();
}

export function downloadUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${DOWNLOAD_BASE}${normalizedPath}`;
}
