export async function withDeadline(task, timeoutMs, label = "Operação") {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label} excedeu ${timeoutMs}ms.`);
      error.code = "ATLAS_DEADLINE";
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(task), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export const isDeadlineError = error => error?.code === "ATLAS_DEADLINE";
