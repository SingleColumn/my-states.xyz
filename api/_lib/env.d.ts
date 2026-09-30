/**
 * The server functions read two variables and nothing else. Declaring
 * `process` here rather than taking a dependency on @types/node keeps the
 * package list where it was; these files use no other Node API.
 */
declare const process: {
  env: Record<string, string | undefined>
}
