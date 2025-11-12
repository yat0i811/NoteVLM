from __future__ import annotations

import io
import re
import time
from dataclasses import dataclass
from html import unescape
from pathlib import Path
from typing import List

import html2text
from PIL import Image

try:
    import pypdfium2 as pdfium
except ImportError:  # pragma: no cover - optional dependency should exist in runtime
    pdfium = None  # type: ignore

from .config import settings
from .local_qwen import GenerationResult, LocalQwenUnavailable, get_local_qwen_client


class QwenClientError(RuntimeError):
    pass


@dataclass
class PreparedImage:
    data: bytes
    width: int
    height: int


@dataclass
class PageConversion:
    content: str
    model_prepare_seconds: float
    inference_seconds: float
    image: PreparedImage | None = None


@dataclass
class DigitalizationResult:
    pages: List[PageConversion]
    total_seconds: float


class QwenClient:
    def __init__(self) -> None:
        self.mock = settings.qwen_mock
        self.page_limit = settings.pdf_page_limit
        self._markdown_converter = html2text.HTML2Text()
        self._markdown_converter.body_width = 0
        self._markdown_converter.ignore_images = True
        self._markdown_converter.ignore_links = False
        self._markdown_converter.single_line_break = True

    def digitalize(self, file_path: Path, target_format: str, model_id: str | None = None) -> DigitalizationResult:
        if self.mock:
            return self._mock_response(file_path, target_format)

        selected_model = model_id or settings.qwen_local_model

        images = self._prepare_images(file_path)
        is_multi_page_pdf = file_path.suffix.lower() == ".pdf" and len(images) > 1

        started_at = time.monotonic()
        pages: List[PageConversion] = []

        normalize_math = (
            target_format in {"markdown", "layout"}
            and selected_model not in settings.chandra_available_models
        )

        if is_multi_page_pdf:
            total_pages = len(images)
            for index, image in enumerate(images, start=1):
                prompt = self._build_prompt(
                    target_format,
                    page_number=index,
                    total_pages=total_pages,
                    model_id=selected_model,
                )
                generation = self._call_local([image.data], prompt, selected_model)
                content = self._postprocess_output(
                    generation.content,
                    target_format if target_format != "layout" else "markdown",
                    selected_model,
                )
                if normalize_math:
                    content = self._normalize_markdown_math(content)
                pages.append(
                    PageConversion(
                        content=content,
                        model_prepare_seconds=generation.model_prepare_seconds,
                        inference_seconds=generation.inference_seconds,
                        image=image,
                    )
                )
        else:
            prompt = self._build_prompt(target_format, model_id=selected_model)
            generation = self._call_local([img.data for img in images], prompt, selected_model)
            content = self._postprocess_output(
                generation.content,
                target_format if target_format != "layout" else "markdown",
                selected_model,
            )
            if normalize_math:
                content = self._normalize_markdown_math(content)
            pages.append(
                PageConversion(
                    content=content,
                    model_prepare_seconds=generation.model_prepare_seconds,
                    inference_seconds=generation.inference_seconds,
                    image=images[0] if images else None,
                )
            )

        total_seconds = time.monotonic() - started_at
        if not pages:
            raise QwenClientError("Digitalization produced no content")
        return DigitalizationResult(pages=pages, total_seconds=total_seconds)

    def _prepare_images(self, file_path: Path) -> List[PreparedImage]:
        suffix = file_path.suffix.lower()
        if suffix == ".pdf":
            if pdfium is None:
                raise QwenClientError("pypdfium2 is required for PDF processing")
            return self._pdf_to_images(file_path)

        with Image.open(file_path) as img:
            buffered = io.BytesIO()
            converted = img.convert("RGB")
            converted.save(buffered, format="PNG")
            width, height = converted.size
            return [PreparedImage(data=buffered.getvalue(), width=width, height=height)]

    def _pdf_to_images(self, file_path: Path) -> List[PreparedImage]:
        pdf = pdfium.PdfDocument(str(file_path))
        images: List[PreparedImage] = []
        for page_index in range(min(len(pdf), self.page_limit)):
            page = pdf.get_page(page_index)
            pil_image = page.render(scale=300 / 72).to_pil()
            buffered = io.BytesIO()
            pil_image.save(buffered, format="PNG")
            width, height = pil_image.size
            images.append(PreparedImage(data=buffered.getvalue(), width=width, height=height))
        pdf.close()
        if not images:
            raise QwenClientError("PDF produced no renderable pages")
        return images

    def _build_prompt(
        self,
        target_format: str,
        *,
        page_number: int | None = None,
        total_pages: int | None = None,
        model_id: str | None = None,
    ) -> str:
        page_context = ""
        if page_number is not None and total_pages is not None:
            page_context = (
                f" Focus exclusively on the content of page {page_number} out of {total_pages}."
                " Do not reference or infer details from other pages."
            )
        is_deepseek = model_id in settings.deepseek_available_models
        is_chandra = model_id in settings.chandra_available_models
        if target_format in {"markdown", "layout"}:
            if is_deepseek:
                return "Transcribe the document in the image into Markdown format." + page_context
            if is_chandra:
                return (
                    "Transcribe the document in the image into GitHub-flavored Markdown. Preserve headings, ordered and unordered lists, tables, and mathematical expressions. "
                    "Use Markdown syntax only (for example, headings with '#', lists with '-', tables with pipes, inline math with '$...$', block math with '$$...$$'). "
                    "Do not include any HTML or XML tags, code fences, or commentary."
                    + page_context
                )
            return (
                "Convert the provided document into clean Markdown. Preserve headings, lists, tables, and inline formatting. "
                "Represent mathematical expressions as plain text within the flow without wrapping them in dollar signs or other TeX delimiters. "
                "Do not add commentary."
                + page_context
            )
        if is_deepseek:
            return "Transcribe the document in the image into LaTeX body content." + page_context
        if is_chandra:
            return (
                "Transcribe the document in the image into LaTeX body content. Preserve structural elements such as sections, lists, tables, and equations using standard LaTeX environments. "
                "Return only valid LaTeX without wrapping it in HTML, XML, or code fences, and do not add commentary."
                + page_context
            )
        return (
            "Convert the provided document into well-formatted LaTeX. Include document structure with sections, lists, tables, and appropriate math environments (such as equation, align, or inline math) as needed. "
            "Return only valid LaTeX body content and avoid Markdown syntax."
            + page_context
        )

    def _mock_response(self, file_path: Path, target_format: str) -> DigitalizationResult:
        name = file_path.name
        page_count = 1
        if file_path.suffix.lower() == ".pdf":
            page_count = self._mock_pdf_page_count(file_path)

        responses: List[PageConversion] = []
        for index in range(1, page_count + 1):
            suffix = "" if page_count == 1 else f" (Page {index})"
            if target_format in {"markdown", "layout"}:
                content = (
                    f"# Mock Markdown for {name}{suffix}\n\n- This is placeholder content.\n- Replace with real output when Qwen3 is configured."
                )
            else:
                content = (
                    "% Mock LaTeX output\n"
                    "\\section*{Mock Document}"
                    f"\nThis is placeholder LaTeX for {name}{suffix}.\\newline\\newline\\textit{{Configure Qwen3 to get real results.}}"
                )
            responses.append(
                PageConversion(content=content, model_prepare_seconds=0.0, inference_seconds=0.0)
            )
        return DigitalizationResult(pages=responses, total_seconds=0.0)

    def _mock_pdf_page_count(self, file_path: Path) -> int:
        if pdfium is None:
            return 1
        try:
            pdf = pdfium.PdfDocument(str(file_path))
        except Exception:
            return 1
        try:
            return max(1, min(len(pdf), self.page_limit))
        finally:
            pdf.close()

    def _call_local(self, images: List[bytes], prompt: str, model_id: str) -> GenerationResult:
        try:
            client = get_local_qwen_client(model_id)
        except LocalQwenUnavailable as exc:
            raise QwenClientError(str(exc))

        pil_images: List[Image.Image] = []
        for data in images:
            with Image.open(io.BytesIO(data)) as img:
                pil_images.append(img.convert("RGB"))
        try:
            result: GenerationResult = client.generate_with_metrics(pil_images, prompt)
        except Exception as exc:  # pragma: no cover - runtime errors only
            raise QwenClientError(f"Local inference failed: {exc}") from exc
        return result

    def _normalize_markdown_math(self, content: str) -> str:
        def replace_block(match: re.Match[str]) -> str:
            inner = match.group(1)
            return inner.strip()

        content = re.sub(r"\$\$\s*(.*?)\s*\$\$", replace_block, content, flags=re.DOTALL)
        content = re.sub(r"\$\s*(.*?)\s*\$", replace_block, content)
        return content

    def _postprocess_output(self, content: str, target_format: str, model_id: str) -> str:
        if model_id in settings.chandra_available_models:
            if target_format == "markdown":
                return self._convert_chandra_to_markdown(content)
            if target_format == "latex":
                return self._convert_chandra_to_latex(content)
        return content

    def _convert_chandra_to_markdown(self, content: str) -> str:
        sanitized = self._replace_chandra_math(content, "\n$$\n", "\n$$\n", "$")
        markdown = self._markdown_converter.handle(unescape(sanitized))
        cleaned = markdown.strip()
        cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
        return cleaned

    def _convert_chandra_to_latex(self, content: str) -> str:
        markdown = self._convert_chandra_to_markdown(content)
        latex = self._markdown_to_latex(markdown)
        return latex

    def _replace_chandra_math(
        self,
        content: str,
        block_open: str,
        block_close: str,
        inline_delim: str,
    ) -> str:
        block_pattern = re.compile(r"<math[^>]*display=\"block\"[^>]*>(.*?)</math>", re.IGNORECASE | re.DOTALL)
        inline_pattern = re.compile(r"<math[^>]*>(.*?)</math>", re.IGNORECASE | re.DOTALL)

        def block_repl(match: re.Match[str]) -> str:
            expr = unescape(match.group(1).strip())
            return f"{block_open}{expr}{block_close}"

        def inline_repl(match: re.Match[str]) -> str:
            expr = unescape(match.group(1).strip())
            return f"{inline_delim}{expr}{inline_delim}"

        without_block = block_pattern.sub(block_repl, content)
        without_inline = inline_pattern.sub(inline_repl, without_block)
        return without_inline

    def _markdown_to_latex(self, markdown: str) -> str:
        lines = markdown.strip().splitlines()
        result: list[str] = []
        list_state: str | None = None

        def close_list() -> None:
            nonlocal list_state
            if list_state == "itemize":
                result.append("\\end{itemize}")
            elif list_state == "enumerate":
                result.append("\\end{enumerate}")
            list_state = None

        i = 0
        while i < len(lines):
            line = lines[i]
            stripped = line.strip()

            if not stripped:
                close_list()
                result.append("")
                i += 1
                continue

            if stripped == "$$":
                close_list()
                i += 1
                expr_lines: list[str] = []
                while i < len(lines) and lines[i].strip() != "$$":
                    expr_lines.append(lines[i])
                    i += 1
                expr = "\n".join(expr_lines).strip()
                if i < len(lines) and lines[i].strip() == "$$":
                    i += 1
                if expr:
                    result.append("\\[")
                    result.append(expr)
                    result.append("\\]")
                continue

            if stripped.startswith("#"):
                close_list()
                level = len(stripped) - len(stripped.lstrip("#"))
                title = stripped[level:].strip()
                command = "\\section*"
                if level == 2:
                    command = "\\subsection*"
                elif level >= 3:
                    command = "\\subsubsection*"
                result.append(f"{command}{{{title}}}")
                i += 1
                continue

            if stripped in {"---", "***"}:
                close_list()
                result.append("\\hrule")
                i += 1
                continue

            bullet_match = re.match(r"^[-*+]\s+(.*)", stripped)
            if bullet_match:
                text = self._convert_inline_markdown_math_to_latex(bullet_match.group(1).strip())
                if list_state != "itemize":
                    close_list()
                    result.append("\\begin{itemize}")
                    list_state = "itemize"
                result.append(f"\\item {text}")
                i += 1
                continue

            numbered_match = re.match(r"^\d+[.)]\s+(.*)", stripped)
            if numbered_match:
                text = self._convert_inline_markdown_math_to_latex(numbered_match.group(1).strip())
                if list_state != "enumerate":
                    close_list()
                    result.append("\\begin{enumerate}")
                    list_state = "enumerate"
                result.append(f"\\item {text}")
                i += 1
                continue

            close_list()
            text = self._convert_inline_markdown_math_to_latex(stripped)
            result.append(text)
            i += 1

        close_list()
        latex = "\n".join(result)
        latex = re.sub(r"\n{3,}", "\n\n", latex)
        return latex.strip()

    def _convert_inline_markdown_math_to_latex(self, text: str) -> str:
        return re.sub(
            r"\$(.+?)\$",
            lambda m: f"\\({m.group(1).strip()}\\)",
            text,
        )


def get_qwen_client() -> QwenClient:
    return QwenClient()
