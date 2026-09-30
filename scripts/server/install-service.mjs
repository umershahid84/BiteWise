// npm run service:install [-- --port 8080 ...]: installs Rescue Bites as a systemd service on a Linux server
// (install-service.sh, run with sudo). Windows and macOS have no systemd, so there it explains what to do instead.
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);

if (process.platform !== 'linux') {
  console.log(`The rescuebites service is for Linux servers (systemd), so there is nothing to install on this computer.
To run the app here:   npm run build, then npm start   (or npm run dev while developing)
To update it later:    stop the app (Ctrl+C), npm run update, then npm start`);
  process.exit(0);
}

const asRoot = process.getuid?.() === 0;
const [command, ...rest] = asRoot ? ['bash', 'scripts/server/install-service.sh'] : ['sudo', 'bash', 'scripts/server/install-service.sh'];
const result = spawnSync(command, [...rest, ...args], { stdio: 'inherit' });
process.exit(result.status ?? 1);
