import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), '..');

const tasks = [
  {
    source: path.join(projectRoot, 'vendor', 'safer-buffer', 'safer.js'),
    target: path.join(projectRoot, 'node_modules', 'safer-buffer', 'safer.js'),
  },
];

for (const task of tasks) {
  const { source, target } = task;
  try {
    if (!existsSync(source)) continue;
    const targetDir = path.dirname(target);
    if (!existsSync(targetDir)) continue;

    const sourceContent = readFileSync(source);
    let shouldWrite = true;
    if (existsSync(target)) {
      const currentContent = readFileSync(target);
      shouldWrite = !currentContent.equals(sourceContent);
    }

    if (shouldWrite) {
      mkdirSync(targetDir, { recursive: true });
      writeFileSync(target, sourceContent);
      console.log(`[postinstall] Patched ${path.relative(projectRoot, target)}`);
    }
  } catch (err) {
    console.warn(`[postinstall] Failed to patch ${path.relative(projectRoot, target)}:`, err?.message ?? err);
  }
}
