// Lambda names are kebab-case; each one's entrypoint folder under src/functions is the snake_case form.
export function lambdaFolderName(functionName: string): string {
  return functionName.replace(/-/g, '_');
}
