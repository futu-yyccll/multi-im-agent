export function createLogger(scope) {
  return (message) => {
    process.stderr.write(`[${scope}] ${message}\n`);
  };
}

