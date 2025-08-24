// scripts/organize_career.js
// Node.js標準モジュールのみで動作
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve('.');
const LONG_SRC = path.join(ROOT, 'career_long.md');
const LONG_DIR = path.join(ROOT, 'long');
const LONG_INDEX = path.join(LONG_DIR, 'index.md');
const SHORT = path.join(ROOT, 'career.md');

if (!fs.existsSync(LONG_SRC)) {
  console.error('career_long.md が見つかりません。実行場所を確認してください。');
  process.exit(1);
}

// ユーティリティ
const toSafeFilename = (s) => {
  // ファイル名安全化（Windows向け: 禁止文字削除、スペース→_）
  return s
    .replace(/[\\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[()（）]/g, '')
    .slice(0, 80);
};

const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, s) => fs.writeFileSync(p, s, 'utf8');

const md = read(LONG_SRC);
const shortExists = fs.existsSync(SHORT);
const shortMd = shortExists ? read(SHORT) : '';

// 「職務経歴」セクションの抽出（タイトル「職務経歴書」は除外）
const topSectionRegex = /^#\s*[^\n]*?職務経歴(?!書)[^\n]*$/m;
const topMatch = md.match(topSectionRegex);
if (!topMatch) {
  console.error('「職務経歴」セクションが見つかりません。');
  process.exit(1);
}
const startIdx = topMatch.index;
const afterTop = md.slice(startIdx);

// 次のトップレベル見出し(# )までを切り出し
const nextTopRegex = /^#\s+/m;
const nextTopMatch = afterTop.slice(1).match(nextTopRegex);
const section = nextTopMatch
  ? afterTop.slice(0, 1 + nextTopMatch.index)
  : afterTop;

// 「職務経歴」配下の会社見出し（##）ごとに分割
const lines = section.split('\n');
let blocks = [];
let current = [];

for (const line of lines) {
  if (/^##\s+/.test(line)) {
    if (current.length) blocks.push(current);
    current = [line];
  } else {
    if (current.length) current.push(line);
  }
}
if (current.length) blocks.push(current);

// 会社ごとのブロック情報整形（long 由来）
let entries = blocks
  .map((blk) => {
    const header = blk[0] || '';
    // タイトル行から会社名と期間を抽出（全角/半角の括弧対応）
    // 例: "## 株式会社でらゲー（2017年10月〜現職）"
    const h = header.replace(/^##\s+/, '').trim();

    // company と period 抽出
    let company = h;
    let period = '';
    const mFull = h.match(/^(.*?)（(.*)）$/); // 全角
    const mHalf = h.match(/^(.*?)\((.*)\)$/); // 半角
    if (mFull) {
      company = mFull[1].trim();
      period = mFull[2].trim();
    } else if (mHalf) {
      company = mHalf[1].trim();
      period = mHalf[2].trim();
    }

    // 開始年（YYYY）推定
    let startYear = null;
    const ym = period.match(/(20\d{2}|19\d{2})[\/\-年]?/);
    if (ym) startYear = ym[1];

    // ソートキー（新しい順=大きいほど新）
    const sortKey = startYear ? parseInt(startYear, 10) : -1;

    // 本文（見出し行以降）
    const body = blk.slice(1).join('\n').trim();

    return {
      company,
      period,
      headerLine: header,
      body,
      sortKey
    };
  })
  .filter((e) => e.company);

// 新しい順にソート
entries.sort((a, b) => (b.sortKey - a.sortKey));

// career.md に存在して long 側に無い会社があればプレースホルダで補完
function parseShortCareerHeadings(shortContent) {
  const topRegex = /^##\s*[^\n]*?職務経歴[^\n]*$/m;
  const m = shortContent.match(topRegex);
  if (!m) return [];
  const start = m.index;
  const after = shortContent.slice(start);
  const nextTop = after.slice(1).match(/^##\s+/m);
  const section = nextTop ? after.slice(0, 1 + nextTop.index) : after;
  const lines2 = section.split('\n');
  const heads = [];
  for (const line of lines2) {
    if (/^###\s+/.test(line)) {
      const h = line.replace(/^###\s+/, '').trim();
      let company = h;
      let period = '';
      const mFull = h.match(/^(.*?)（(.*)）$/); // 全角
      const mHalf = h.match(/^(.*?)\((.*)\)$/); // 半角
      if (mFull) {
        company = mFull[1].trim();
        period = mFull[2].trim();
      } else if (mHalf) {
        company = mHalf[1].trim();
        period = mHalf[2].trim();
      }
      // filter out non-company headings if any
      if (company) heads.push({ company, period });
    }
  }
  return heads;
}

if (shortExists) {
  const shortHeads = parseShortCareerHeadings(shortMd);
  const existingCompanies = new Set(entries.map(e => e.company));
  for (const sh of shortHeads) {
    if (!existingCompanies.has(sh.company)) {
      let startYear = -1;
      const ym = sh.period.match(/(20\d{2}|19\d{2})[\/\-年]?/);
      if (ym) startYear = parseInt(ym[1], 10);
      entries.push({
        company: sh.company,
        period: sh.period,
        headerLine: `## ${sh.company}（${sh.period || '期間不明'}）`,
        body: '詳細は準備中です。',
        sortKey: startYear > 0 ? startYear : -1,
      });
      existingCompanies.add(sh.company);
    }
  }
  // 追加後に再ソート
  entries.sort((a, b) => (b.sortKey - a.sortKey));
}

// long/ ディレクトリ作成・初期化（中身をクリア）
if (!fs.existsSync(LONG_DIR)) {
  fs.mkdirSync(LONG_DIR, { recursive: true });
} else {
  for (const f of fs.readdirSync(LONG_DIR)) {
    try { fs.unlinkSync(path.join(LONG_DIR, f)); } catch (_) {}
  }
}

// 各記事ファイル生成（前/次リンクは後で2周目で追記）
const files = entries.map((e, idx) => {
  const prefix = e.sortKey > 0 ? `${e.sortKey}` : `${idx + 1}`;
  const fname = `${prefix}-${toSafeFilename(e.company)}.md`;
  const fpath = path.join(LONG_DIR, fname);
  const content =
`# ${e.company}（${e.period || '期間不明'}）

${e.body}

---
<!-- nav will be injected -->
`;
  write(fpath, content);
  return { ...e, fpath, fname, idx };
});

// 前/次ナビゲーションを追記（新→旧）
files.forEach((e, i) => {
  const newer = i === 0 ? null : files[i - 1];
  const older = i === files.length - 1 ? null : files[i + 1];
  const nav = [
    '## ナビゲーション',
    newer ? `- 次（新しい）: [${newer.company}（${newer.period || '期間不明'}）](./${newer.fname})` : '- 次（新しい）: なし',
    older ? `- 前（古い）: [${older.company}（${older.period || '期間不明'}）](./${older.fname})` : '- 前（古い）: なし',
    ''
  ].join('\n');

  let cur = read(e.fpath);
  cur = cur.replace('<!-- nav will be injected -->', nav);
  write(e.fpath, cur);
});

// long/index.md 生成（新しい順）
const indexMd =
`# 職務経歴（長文・索引）

最新→古い の順で並べています。

${files.map(f => `- [${f.company}（${f.period || '期間不明'}）](./${f.fname})`).join('\n')}
`;
write(LONG_INDEX, indexMd);

// career.md のリンク領域を更新（存在すればマーカー内を書き換え、無ければ末尾に追加）
const LINK_START = '<!-- LONG_LINKS_START -->';
const LINK_END = '<!-- LONG_LINKS_END -->';
const linksBlock =
`${LINK_START}
## 詳細（長文）
「最新→古い」の順で長文を掲載しています。詳細は以下をご覧ください。

${files.map(f => `- [${f.company}（${f.period || '期間不明'}）](./long/${f.fname})`).join('\n')}

${LINK_END}
`;

if (fs.existsSync(SHORT)) {
  let short = read(SHORT);
  if (short.includes(LINK_START) && short.includes(LINK_END)) {
    short = short.replace(
      new RegExp(`${LINK_START}[\\s\\S]*?${LINK_END}`, 'm'),
      linksBlock.trim()
    );
  } else {
    short = (short.trimEnd() + '\n\n' + linksBlock).trim() + '\n';
  }
  // 会社見出しにリンクを付与（存在する会社のみ）
  const fileMap = new Map(entries.map(e => [e.company, `./long/${e.sortKey > 0 ? `${e.sortKey}-${toSafeFilename(e.company)}.md` : `${toSafeFilename(e.company)}.md`}`]));
  const linked = short.split('\n').map(line => {
    if (/^###\s+/.test(line)) {
      const h = line.replace(/^###\s+/, '').trim();
      let company = h;
      let period = '';
      const mFull = h.match(/^(.*?)（(.*)）$/);
      const mHalf = h.match(/^(.*?)\((.*)\)$/);
      if (mFull) { company = mFull[1].trim(); period = mFull[2].trim(); }
      else if (mHalf) { company = mHalf[1].trim(); period = mHalf[2].trim(); }
      const href = fileMap.get(company);
      if (href) {
        const title = period ? `${company} (${period})` : company;
        return `### [${title}](${href})`;
      }
    }
    return line;
  }).join('\n');
  write(SHORT, linked);
} else {
  // career.md が無い場合は生成
  write(SHORT, `# 職務経歴書（短文）\n\n${linksBlock}\n`);
}

console.log('Done.');
console.log(`- 分割先: ${LONG_DIR}`);
console.log(`- 索引: ${LONG_INDEX}`);
console.log(`- career.md: 長文リンク一覧を挿入/更新しました。`);


