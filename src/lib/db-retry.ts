function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientPrismaError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    name.includes("PrismaClientInitializationError") ||
    message.includes("PrismaClientInitializationError") ||
    message.includes("Can't reach database server") ||
    message.includes("Timed out fetching a new connection") ||
    message.includes("server login has been failing") ||
    message.includes("partial pkt in login phase") ||
    message.includes("out of memory") ||
    message.includes("Error in PostgreSQL connection") ||
    message.includes("connection")
  );
}

export async function withDbRetry<T>(task: () => Promise<T>, retries = 1): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !isTransientPrismaError(error)) break;
      await wait(350 * (attempt + 1));
    }
  }
  throw lastError;
}
