export function interpolate(input: string, values: Record<string, string | undefined>): string {
  return input.replace(/\$(\w+)|\$\{(\w+)\}/g, (match, bare: string | undefined, braced: string | undefined) => {
    const key = bare ?? braced
    if (!key) {
      return match
    }

    return values[key] ?? match
  })
}

export function interpolateRecord(
  input: Record<string, string> | undefined,
  values: Record<string, string | undefined>
): Record<string, string> {
  const output: Record<string, string> = {}

  for (const [key, value] of Object.entries(input ?? {})) {
    output[key] = interpolate(value, values)
  }

  return output
}

export function interpolateArray(input: string[] | undefined, values: Record<string, string | undefined>): string[] {
  return (input ?? []).map((value) => interpolate(value, values))
}
