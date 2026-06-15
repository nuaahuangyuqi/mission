import path from 'node:path';
import { TextDecoder } from 'node:util';
import mammoth from 'mammoth';
import WordExtractor from 'word-extractor';
import XLSX from 'xlsx';
import { PDFParse } from 'pdf-parse';

const wordExtractor = new WordExtractor();
const WORD_EXTENSIONS = new Set(['.doc', '.docx']);
const EXCEL_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv']);
const PDF_EXTENSIONS = new Set(['.pdf']);
const TEXT_EXTENSIONS = new Set(['.txt', '.text', '.md', '.markdown']);

function decodeBase64Content(base64Value = '') {
  const normalized = String(base64Value || '').trim();
  if (!normalized) return null;
  try {
    return Buffer.from(normalized, 'base64');
  } catch {
    throw new Error('文件内容编码无效，无法解析上传文件。');
  }
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeWhitespace(text = '') {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/\u0007/g, ' ')
    .replace(/\u000b/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \f]{2,}/g, ' ')
    .trim();
}

function decodeTextBuffer(buffer) {
  if (!buffer?.length) return '';

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    try {
      return new TextDecoder('gb18030', { fatal: true }).decode(buffer);
    } catch {
      return buffer.toString('utf8');
    }
  }
}

function clipText(text = '', maxLength = 220) {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function splitParagraphs(text = '') {
  return normalizeWhitespace(text)
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function chunkParagraphs(paragraphs = [], maxChars = 520, maxChunks = 4) {
  const chunks = [];
  let current = [];
  let currentLength = 0;

  for (const paragraph of paragraphs) {
    const value = String(paragraph || '').trim();
    if (!value) continue;

    const nextLength = currentLength + value.length + (current.length ? 2 : 0);
    if (current.length && nextLength > maxChars) {
      chunks.push(current.join('\n\n'));
      current = [value];
      currentLength = value.length;
      if (chunks.length >= maxChunks) break;
      continue;
    }

    current.push(value);
    currentLength = nextLength;
  }

  if (current.length && chunks.length < maxChunks) {
    chunks.push(current.join('\n\n'));
  }

  return chunks.filter(Boolean);
}

function toCellText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function normalizeMatrixRows(matrix = []) {
  return matrix
    .map((row) => Array.isArray(row) ? row.map(toCellText) : [])
    .filter((row) => row.some((cell) => cell !== ''));
}

function buildSheetColumns(headerRow = [], columnCount = 0) {
  return Array.from({ length: columnCount }, (_, index) => headerRow[index] || `列 ${index + 1}`);
}

function buildSheetPreview(sheetName, matrix = []) {
  const rows = normalizeMatrixRows(matrix);
  if (!rows.length) {
    return {
      name: sheetName,
      columns: [],
      rows: [],
      totalRows: 0,
      totalColumns: 0,
      summary: '当前工作表为空。',
      extractionText: '',
    };
  }

  const widestRow = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const firstRow = rows[0] || [];
  const headerCandidateCount = firstRow.filter(Boolean).length;
  const hasHeader = headerCandidateCount > 0 && (rows.length > 1 || firstRow.length > 1);
  const columns = buildSheetColumns(hasHeader ? firstRow : [], widestRow);
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const previewRows = dataRows.slice(0, 40).map((row) => columns.map((_, index) => row[index] || ''));
  const extractionRows = dataRows.slice(0, 60).map((row) => columns
    .map((column, index) => `${column}: ${row[index] || ''}`)
    .join('，'))
    .filter(Boolean);

  return {
    name: sheetName,
    columns,
    rows: previewRows,
    totalRows: dataRows.length,
    totalColumns: columns.length,
    summary: dataRows.length
      ? `共 ${dataRows.length} 行、${columns.length} 列，当前预览前 ${previewRows.length} 行。`
      : `仅检测到表头，共 ${columns.length} 列。`,
    extractionText: [`工作表：${sheetName}`, ...extractionRows].join('\n'),
  };
}

function createWorkbookPreviewPayload(fileName, description, workbook) {
  const extractedAt = nowIso();
  const sheets = workbook.SheetNames
    .map((sheetName) => {
      const worksheet = workbook.Sheets[sheetName];
      const matrix = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        raw: false,
        defval: '',
        blankrows: false,
      });
      return buildSheetPreview(sheetName, matrix);
    })
    .filter((item) => item.columns.length || item.rows.length);

  return {
    previewType: 'workbook',
    payload: {
      title: fileName || 'Excel 表格导入',
      description: description || '工作簿内容已解析，可按工作表浏览。',
      sheets: sheets.map(({ extractionText, ...sheet }) => sheet),
    },
    extractionDrafts: sheets.map((sheet) => ({
      title: `${fileName || 'Excel 导入'} / ${sheet.name}`,
      text: sheet.extractionText,
      summary: sheet.summary,
      sourceType: 'excel-sheet',
      sourceName: fileName || 'Excel 导入',
      fileName: fileName || '',
      extractedAt,
    })),
  };
}

async function extractWordText(buffer, extension) {
  if (!buffer?.length) {
    return '';
  }

  if (extension === '.doc') {
    const extracted = await wordExtractor.extract(buffer);
    return normalizeWhitespace([
      extracted.getHeaders({ includeFooters: false }),
      extracted.getBody(),
      extracted.getFootnotes(),
      extracted.getTextboxes({ includeHeadersAndFooters: false }),
    ].filter(Boolean).join('\n\n'));
  }

  const result = await mammoth.extractRawText({ buffer });
  return normalizeWhitespace(result.value || '');
}

async function createWordPreviewPayload(fileName, description, extension, buffer, textContent) {
  const rawText = buffer?.length
    ? await extractWordText(buffer, extension)
    : normalizeWhitespace(textContent);
  const paragraphs = splitParagraphs(rawText);
  const chunks = chunkParagraphs(paragraphs.length ? paragraphs : [rawText]);

  const extractedAt = nowIso();
  return {
    previewType: 'document',
    payload: {
      title: fileName || 'Word 文档导入',
      description: description || '文档正文已提取，可直接浏览段落内容。',
      content: clipText(rawText, 4000),
      paragraphs: paragraphs.slice(0, 80),
      stats: {
        paragraphCount: paragraphs.length,
        charCount: rawText.length,
      },
    },
    extractionDrafts: chunks.map((text, index) => ({
      title: chunks.length > 1 ? `${fileName || 'Word 文档'} / 片段 ${index + 1}` : (fileName || 'Word 文档'),
      text,
      summary: clipText(text, 160),
      sourceType: 'word-document',
      sourceName: fileName || 'Word 文档',
      fileName: fileName || '',
      extractedAt,
    })),
  };
}

async function extractPdfText(buffer) {
  if (!buffer?.length) {
    return '';
  }

  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return normalizeWhitespace(result?.text || '');
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function createPdfPreviewPayload(fileName, description, buffer, textContent) {
  const rawText = buffer?.length
    ? await extractPdfText(buffer)
    : normalizeWhitespace(textContent);
  const paragraphs = splitParagraphs(rawText);
  const chunks = chunkParagraphs(paragraphs.length ? paragraphs : [rawText]);

  const extractedAt = nowIso();
  return {
    previewType: 'document',
    payload: {
      title: fileName || 'PDF 文档导入',
      description: description || 'PDF 正文已提取，可直接浏览段落内容。',
      content: clipText(rawText, 4000),
      paragraphs: paragraphs.slice(0, 80),
      stats: {
        paragraphCount: paragraphs.length,
        charCount: rawText.length,
      },
    },
    extractionDrafts: chunks.map((text, index) => ({
      title: chunks.length > 1 ? `${fileName || 'PDF 文档'} / 片段 ${index + 1}` : (fileName || 'PDF 文档'),
      text,
      summary: clipText(text, 160),
      sourceType: 'pdf-document',
      sourceName: fileName || 'PDF 文档',
      fileName: fileName || '',
      extractedAt,
    })),
  };
}

function createTextPreviewPayload(fileName, description, buffer, textContent) {
  const rawText = normalizeWhitespace(
    textContent || decodeTextBuffer(buffer),
  );
  const paragraphs = splitParagraphs(rawText);
  const chunks = chunkParagraphs(paragraphs.length ? paragraphs : [rawText]);

  const extractedAt = nowIso();
  return {
    previewType: 'document',
    payload: {
      title: fileName || '文本文件导入',
      description: description || '文本内容已提取，可直接用于规划算法分析。',
      content: clipText(rawText, 4000),
      paragraphs: paragraphs.slice(0, 80),
      stats: {
        paragraphCount: paragraphs.length,
        charCount: rawText.length,
      },
    },
    extractionDrafts: chunks.map((text, index) => ({
      title: chunks.length > 1 ? `${fileName || '文本文件'} / 片段 ${index + 1}` : (fileName || '文本文件'),
      text,
      summary: clipText(text, 160),
      sourceType: 'text-file',
      sourceName: fileName || '文本文件',
      fileName: fileName || '',
      extractedAt,
    })),
  };
}

function parseWorkbook(buffer, textContent, fileName) {
  const extension = path.extname(fileName || '').toLowerCase();

  if (buffer?.length) {
    if (extension === '.csv') {
      return XLSX.read(buffer.toString('utf8'), {
        type: 'string',
        raw: false,
        codepage: 65001,
      });
    }
    return XLSX.read(buffer, { type: 'buffer', cellDates: true });
  }

  if (textContent) {
    if (extension === '.csv') {
      return XLSX.read(textContent, { type: 'string', raw: false, codepage: 65001 });
    }
    return XLSX.read(textContent, { type: 'string', raw: false });
  }

  return null;
}

export async function normalizeImportedPreview(type, body = {}) {
  const fileName = String(body.fileName || '').trim();
  const description = String(body.description || '').trim();
  const textContent = String(body.textContent || '').trim();
  const extension = String(body.fileExtension || path.extname(fileName || '')).toLowerCase();
  const buffer = decodeBase64Content(body.fileContentBase64);

  if (type === 'word') {
    if (extension && !WORD_EXTENSIONS.has(extension) && !textContent) {
      throw new Error('当前仅支持导入 .doc 或 .docx Word 文件。');
    }
    try {
      return await createWordPreviewPayload(fileName, description, extension || '.docx', buffer, textContent);
    } catch (error) {
      throw new Error(`Word 文件解析失败：${error?.message || '请检查文件内容或编码格式。'}`);
    }
  }

  if (type === 'excel') {
    if (extension && !EXCEL_EXTENSIONS.has(extension) && !textContent) {
      throw new Error('当前仅支持导入 .xls、.xlsx 或 .csv Excel 文件。');
    }

    try {
      const workbook = parseWorkbook(buffer, textContent, fileName);
      if (!workbook) {
        return {
          previewType: 'workbook',
          payload: {
            title: fileName || 'Excel 表格导入',
            description: description || '未检测到可解析的工作簿内容。',
            sheets: [],
          },
          extractionDrafts: [],
        };
      }

      return createWorkbookPreviewPayload(fileName, description, workbook);
    } catch (error) {
      throw new Error(`Excel/CSV 文件解析失败：${error?.message || '请检查表格结构和文件编码。'}`);
    }
  }

  if (type === 'pdf') {
    if (extension && !PDF_EXTENSIONS.has(extension) && !textContent) {
      throw new Error('当前仅支持导入 .pdf 文件。');
    }
    try {
      return await createPdfPreviewPayload(fileName, description, buffer, textContent);
    } catch (error) {
      throw new Error(`PDF 文件解析失败：${error?.message || '请检查文件是否损坏或加密。'}`);
    }
  }

  if (type === 'text') {
    if (extension && !TEXT_EXTENSIONS.has(extension) && !textContent) {
      throw new Error('当前仅支持导入 .txt、.text、.md 或 .markdown 文本文件。');
    }
    try {
      return createTextPreviewPayload(fileName, description, buffer, textContent);
    } catch (error) {
      throw new Error(`文本文件解析失败：${error?.message || '请检查文件内容或编码格式。'}`);
    }
  }

  return null;
}
