#!/usr/bin/env node
/**
 * 从花种种子数据自动生成 ids.json（插画 fileID 映射），
 * 省去手动整理 60 条映射的工作。
 *
 * 用法（项目根目录）：
 *   node scripts/gen_ids.js "cloud://环境ID.存储ID/assets/species"
 *
 * 参数：云存储目录前缀——在云开发控制台复制任意一张插画的 fileID，
 *       去掉末尾的 /花名.jpg 即是前缀。
 * 输出：项目根目录 ids.json（供 fill_illustration_ids.js 使用）
 *
 * 前提：60 张插画已按 {id}.jpg 命名上传到云存储 assets/species/ 目录。
 */
const fs = require("fs");
const path = require("path");

function main() {
  const prefix = process.argv[2];
  if (!prefix) {
    console.error('用法: node scripts/gen_ids.js "cloud://环境ID.存储ID/assets/species"');
    process.exit(1);
  }

  const speciesFile = path.join(
    __dirname,
    "..",
    "cloudfunctions",
    "initSpecies",
    "species-data.js"
  );
  const content = fs.readFileSync(speciesFile, "utf8");

  // 提取全部花种 id（拼音小写，如 yueji）
  const ids = [];
  const re = /id:\s*'([a-z0-9]+)'/g;
  let m;
  while ((m = re.exec(content))) ids.push(m[1]);
  if (!ids.length) {
    console.error("未从 species-data.js 提取到花种 id，请检查文件格式");
    process.exit(1);
  }

  // 生成 { id: fileID } 映射：前缀 + /{id}.jpg
  const cleanPrefix = prefix.replace(/\/+$/, "");
  const mapping = {};
  ids.forEach((id) => {
    mapping[id] = `${cleanPrefix}/${id}.jpg`;
  });

  const out = path.join(__dirname, "..", "ids.json");
  fs.writeFileSync(out, JSON.stringify(mapping, null, 2), "utf8");
  console.log(`已生成 ${Object.keys(mapping).length} 条映射 -> ids.json`);
  console.log(`示例: ${ids[0]} -> ${mapping[ids[0]]}`);
}

main();
