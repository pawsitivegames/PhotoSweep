/**
 * @param {Record<string, { source?: unknown, tests?: unknown[] }> | null | undefined} testFiles
 * @returns {{ testFileCount: number, testCaseCount: number }}
 */
export function summarizeMutationTestInventory(testFiles) {
  const files =
    testFiles && typeof testFiles === "object" && !Array.isArray(testFiles)
      ? Object.values(testFiles)
      : []

  return {
    testFileCount: files.length,
    testCaseCount: files.reduce(
      (total, file) => total + (Array.isArray(file?.tests) ? file.tests.length : 0),
      0
    )
  }
}
