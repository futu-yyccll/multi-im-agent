import { spawn } from "node:child_process";

export function larkProfileArgs(profile = "") {
  return profile ? ["--profile", profile] : [];
}

export function runLarkCliJson(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("lark-cli", [...larkProfileArgs(options.larkProfile), ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`lark-cli exited ${code}: ${stderr.trim() || stdout.trim()}`));
        return;
      }

      try {
        resolve(stdout.trim() ? JSON.parse(stdout) : {});
      } catch (error) {
        reject(new Error(`failed to parse lark-cli JSON: ${error.message}; output=${stdout.trim()}`));
      }
    });
  });
}
