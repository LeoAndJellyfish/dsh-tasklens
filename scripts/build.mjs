import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
await mkdir('lib', { recursive: true });
await build({ entryPoints: ['src/index.ts'], outfile: 'lib/index.js', platform: 'node', target: 'node22', format: 'esm', bundle: true, packages: 'external' });
const client = await build({ entryPoints: ['src/client/index.tsx'], platform: 'browser', target: 'es2022', format: 'cjs', bundle: true,
  packages: 'external', write: false });
await writeFile('lib/client.js', `window.__ModuleLoader__.load({id:"dsh-tasklens",factory:(require)=>{var module={exports:{}};var exports=module.exports;\n${client.outputFiles[0].text}\nreturn module.exports;}});\n`);
const types = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--emitDeclarationOnly'], { stdio: 'inherit' });
if (types.status) process.exit(types.status);
console.log('Built TaskLens host, native client and declarations.');
