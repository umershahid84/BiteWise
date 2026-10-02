// npm run update [-- --no-pull] [-- --force]
// On a Linux server running the bitewise systemd service (or an old one named rescuebites or biteback), this runs update.sh, which
// builds while the site keeps running and then restarts the service. Anywhere else (Windows, macOS, or a machine
// without the service) it pulls the latest code, installs packages if they changed and builds; then start the app
// with npm start. Stop the app first, since the build replaces the files it is serving.
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const pull = !args.includes('--no-pull');
const force = args.includes('--force');
const STAMP = '.next/DEPLOYED_COMMIT'; // the commit the current build was made from (update.sh uses the same file)

process.chdir(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));

const fail = (message) => {
  console.error(`Error: ${message}`);
  process.exit(1);
};
const run = (command) => execSync(command, { stdio: 'inherit' });
function git(...gitArgs) {
  const result = spawnSync('git', gitArgs, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${gitArgs.join(' ')} failed`);
  return result.stdout.trim();
}

function hasService() {
  if (process.platform !== 'linux') return false;
  return ['bitewise', 'rescuebites', 'biteback'].some((name) => spawnSync('systemctl', ['cat', name], { stdio: 'ignore' }).status === 0);
}

// True if something (npm start or npm run dev) is answering on the app's port.
function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(false));
  });
}

if (hasService()) {
  const result = spawnSync('bash', ['scripts/server/update.sh', ...args], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

const port = Number(process.env.PORT) || 3000;
if (await portInUse(port)) {
  fail(`the app is running on port ${port}. Stop it first (press Ctrl+C in the window running npm start or npm run dev),
then run npm run update again.`);
}

let isGit = true;
try { git('rev-parse', '--git-dir'); } catch { isGit = false; }
if (pull && !isGit) {
  fail(`this folder isn't a git clone, so there are no updates to pull. Get the latest code with
  git clone https://github.com/umershahid84/RescueBites.git
or run npm run update -- --no-pull to just rebuild what is here.`);
}

const before = isGit ? git('rev-parse', 'HEAD') : '';
if (pull) {
  console.log('==> Pulling the latest code');
  run('git pull --ff-only');
}
const head = isGit ? git('rev-parse', 'HEAD') : '';
const live = fs.existsSync(STAMP) ? fs.readFileSync(STAMP, 'utf8').trim() : '';
if (!force && head && live === head) {
  console.log(`==> Already up to date: ${git('log', '-1', '--format=%h %s')} is built. Start it with: npm start`);
  process.exit(0);
}

// Compare with the commit of the current build (or, without one, the code before pulling).
let base = before;
if (live && isGit) {
  try { git('cat-file', '-e', `${live}^{commit}`); base = live; } catch { /* the build's commit isn't in this clone */ }
}
const changed = (...paths) => isGit && base !== head && spawnSync('git', ['diff', '--quiet', base, head, '--', ...paths]).status !== 0;

if (changed('package-lock.json') || !fs.existsSync('node_modules')) {
  console.log('==> Packages changed: installing');
  run('npm ci');
}

console.log('==> Building');
run('npm run build');
if (head) fs.writeFileSync(STAMP, `${head}\n`);

console.log(`==> Done${head ? `: ${git('log', '-1', '--format=%h %s')}` : ''} is built. Start it with: npm start`);
if (changed('supabase/migrations')) {
  console.log('Note: this update includes database changes (supabase/migrations). Apply them with: npx supabase db push');
}
