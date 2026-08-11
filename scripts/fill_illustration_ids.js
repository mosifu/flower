#!/usr/bin/env node
/**
 * 把云存储 fileID 回填到 species-data.js 的 illustrationFileID 字段。
 *
 * 用法（在项目根目录执行）：
 *   node scripts/fill_illustration_ids.js ids.json
 *
 * ids.json 格式（key 为花种 id，value 为云存储 fileID 或 https URL）：
 * {
 *   "yueji": "cloud://env-xxxx.6565-yyyy/assets/species/yueji.jpg",
 *   "meigui": "https://example.com/species/meigui.jpg"
 * }
 */
const fs = require("fs");
const path = require("path");

function main() {
  /**
   * 脚本入口：读取 ids.json 映射，把 illustrationFileID 回填到 species-data.js
   * @param {void}
   * @returns {void} 直接改写文件，控制台输出回填数量
   */
  const idsFile = process.argv[2];
if (!idsFile) {
  console.error("用法: node scripts/fill_illustration_ids.js ids.json");
  process.exit(1);
}

// 兼容 Windows 记事本等工具写出的 UTF-8 BOM
const raw = fs.readFileSync(idsFile, "utf8").replace(/^\uFEFF/, "");
const mapping = JSON.parse(raw);
const speciesFile = path.join(
  __dirname,
  "..",
  "cloudfunctions",
  "initSpecies",
  "species-data.js"
);
const lines = fs.readFileSync(speciesFile, "utf8").split("\n");

let updated = 0;
for (const [id, fileID] of Object.entries(mapping)) {
  if (!fileID) continue;
  // 找到该花种对象的起始行
  const startIdx = lines.findIndex(
    (l) => l.includes("id:") && l.includes(`'${id}'`)
  );
  if (startIdx < 0) {
    console.warn(`未找到 id=${id}，跳过`);
    continue;
  }
  // 在该对象内找到 illustrationFileID 行并替换
  for (let i = startIdx; i < lines.length; i++) {
    if (lines[i].includes("illustrationFileID:")) {
      lines[i] = lines[i].replace(
        /illustrationFileID:\s*'[^']*'/,
        `illustrationFileID: '${fileID}'`
      );
      updated++;
      break;
    }
    if (lines[i].includes("id:") && i > startIdx && lines[i].includes("'")) {
      // 已越过当前对象仍未找到，避免误改
      break;
    }
  }
}

fs.writeFileSync(speciesFile, lines.join("\n"));
console.log(`完成：已回填 ${updated}/${Object.keys(mapping).length} 个 fileID`);
}

main();
