import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";

const root = resolve(import.meta.dirname, "..");
const errors = [];

async function readJson(path) {
  try {
    return JSON.parse(await readFile(resolve(root, path), "utf8"));
  } catch (error) {
    errors.push(`${path}: ${error.message}`);
    return null;
  }
}

async function exists(path) {
  try {
    return (await stat(resolve(root, path))).isFile();
  } catch {
    return false;
  }
}

async function collectFiles(directory, extension) {
  const base = resolve(root, directory);
  const entries = await readdir(base, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...await collectFiles(relative, extension));
    } else if (entry.name.endsWith(extension)) {
      files.push(relative);
    }
  }
  return files;
}

const appConfig = await readJson("app.json");
await readJson("project.config.json");
await readJson("sitemap.json");

if (!await exists("assets/starbud-share.png")) {
  errors.push("assets/starbud-share.png: missing branded share image");
}

if (appConfig) {
  for (const page of appConfig.pages || []) {
    for (const extension of [".js", ".json", ".wxml", ".wxss"]) {
      const path = `${page}${extension}`;
      if (!await exists(path)) errors.push(`${path}: missing page file`);
    }
  }

  const globalBackground = appConfig.window?.backgroundColor?.toLowerCase();
  const globalBackgroundTextStyle = appConfig.window?.backgroundTextStyle;
  for (const tab of appConfig.tabBar?.list || []) {
    const configPath = `${tab.pagePath}.json`;
    const pageConfig = await readJson(configPath);
    const pageBackground = pageConfig?.backgroundColor?.toLowerCase();
    const pageBackgroundTextStyle = pageConfig?.backgroundTextStyle;
    if (pageBackground && pageBackground !== globalBackground) {
      errors.push(
        `${configPath}: tab page backgroundColor must match the global background to prevent switch flicker`
      );
    }
    if (pageBackgroundTextStyle && pageBackgroundTextStyle !== globalBackgroundTextStyle) {
      errors.push(
        `${configPath}: tab page backgroundTextStyle must match the global background text style`
      );
    }
  }
}

for (const path of await collectFiles(".", ".json")) {
  if (path === "./project.private.config.json") continue;
  await readJson(path.replace(/^\.\//, ""));
}

for (const path of await collectFiles(".", ".js")) {
  try {
    new vm.Script(await readFile(resolve(root, path), "utf8"), { filename: path });
  } catch (error) {
    errors.push(`${path}: ${error.message}`);
  }
}

for (const path of await collectFiles(".", ".wxml")) {
  const source = await readFile(resolve(root, path), "utf8");
  for (const match of source.matchAll(/\bwx:(?:if|elif)="([^"]*)"/g)) {
    if (!match[1].trim().startsWith("{{")) {
      errors.push(`${path}: ${match[0]} must use a {{...}} data binding`);
    }
  }
}

const configSource = await readFile(resolve(root, "config.js"), "utf8");
if (!configSource.includes("https://")) {
  errors.push("config.js: API_BASE_URL must use HTTPS for WeChat");
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Validated ${appConfig.pages.length} pages and native mini program configuration.`);
}
