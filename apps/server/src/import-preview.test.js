import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeImportedPreview } from './import-preview.js';

const MOJIBAKE_PATTERN = /鏂|鈥|鍒|褰|锛|鑳|璇|妯|€|�/;

function assertNoMojibake(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  assert.doesNotMatch(text, MOJIBAKE_PATTERN);
}

test('csv import preview returns readable workbook payload and extraction drafts', async () => {
  const preview = await normalizeImportedPreview('excel', {
    fileName: 'forces.csv',
    fileExtension: '.csv',
    fileContentBase64: Buffer.from('name,count\nalpha,2\nbravo,3\n', 'utf8').toString('base64'),
  });

  assert.equal(preview.previewType, 'workbook');
  assert.equal(preview.payload.title, 'forces.csv');
  assert.equal(preview.payload.description, '工作簿内容已解析，可按工作表浏览。');
  assert.equal(preview.payload.sheets.length, 1);
  assert.deepEqual(preview.payload.sheets[0].columns, ['name', 'count']);
  assert.match(preview.payload.sheets[0].summary, /共 2 行、2 列/);
  assert.equal(preview.extractionDrafts.length, 1);
  assert.match(preview.extractionDrafts[0].text, /工作表：/);
  assert.match(preview.extractionDrafts[0].text, /name: alpha，count: 2/);
  assertNoMojibake(preview);
});

test('excel text preview with only header returns readable empty-data summary', async () => {
  const preview = await normalizeImportedPreview('excel', {
    fileName: 'header-only.csv',
    fileExtension: '.csv',
    textContent: 'name,count\n',
  });

  assert.equal(preview.previewType, 'workbook');
  assert.equal(preview.payload.sheets.length, 1);
  assert.deepEqual(preview.payload.sheets[0].columns, ['name', 'count']);
  assert.equal(preview.payload.sheets[0].summary, '仅检测到表头，共 2 列。');
  assertNoMojibake(preview);
});

test('word text preview returns readable document payload without binary extraction', async () => {
  const preview = await normalizeImportedPreview('word', {
    fileName: 'brief.docx',
    fileExtension: '.docx',
    textContent: '第一段内容。\n\n第二段内容。',
  });

  assert.equal(preview.previewType, 'document');
  assert.equal(preview.payload.title, 'brief.docx');
  assert.equal(preview.payload.description, '文档正文已提取，可直接浏览段落内容。');
  assert.deepEqual(preview.payload.paragraphs, ['第一段内容。', '第二段内容。']);
  assert.equal(preview.extractionDrafts[0].sourceType, 'word-document');
  assertNoMojibake(preview);
});

test('unsupported import extensions return readable validation errors', async () => {
  await assert.rejects(
    () => normalizeImportedPreview('excel', {
      fileName: 'bad.json',
      fileExtension: '.json',
    }),
    /当前仅支持导入 \.xls、\.xlsx 或 \.csv Excel 文件。/,
  );

  await assert.rejects(
    () => normalizeImportedPreview('pdf', {
      fileName: 'bad.txt',
      fileExtension: '.txt',
    }),
    /当前仅支持导入 \.pdf 文件。/,
  );
});
