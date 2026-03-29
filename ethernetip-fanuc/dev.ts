/**
 * Dev runner — uruchamia równolegle serwer Bun i Vite.
 * Używa Bun.spawn (bez zewnętrznego shella) co działa na Windows.
 */

const RESET = '\x1b[0m';
const CYAN  = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED   = '\x1b[31m';

function label(name: string, color: string) {
  return `${color}[${name}]${RESET} `;
}

const server = Bun.spawn(['bun', '--watch', 'src/server/index.ts'], {
  stdout: 'inherit',
  stderr: 'inherit',
  onExit(_, code) {
    console.log(`${label('server', CYAN)}exited with code ${code}`);
  },
});

const client = Bun.spawn(['bun', 'run', 'vite'], {
  stdout: 'inherit',
  stderr: 'inherit',
  onExit(_, code) {
    console.log(`${label('vite', GREEN)}exited with code ${code}`);
  },
});

console.log(`${label('dev', CYAN)}Server + Vite started`);

process.on('SIGINT', () => {
  console.log(`\n${label('dev', RED)}Shutting down...`);
  server.kill();
  client.kill();
  process.exit(0);
});

await Promise.all([server.exited, client.exited]);
