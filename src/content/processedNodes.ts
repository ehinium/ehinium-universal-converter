const processedNodes = new WeakSet<Text>();

export function isProcessed(node: Text): boolean {
  return processedNodes.has(node);
}

export function markProcessed(node: Text): void {
  processedNodes.add(node);
}

export function resetProcessed(node: Text): void {
  processedNodes.delete(node);
}
