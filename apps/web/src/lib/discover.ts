export interface GenreExtra {
  isRequired?: boolean
  options?: string[]
}

export function genreFilterOptions(extra: GenreExtra | undefined): Array<[string, string]> {
  if (!extra) return [["", "Not available"]]
  return [
    ...(!extra.isRequired ? [["", "All genres"] as [string, string]] : []),
    ...(extra.options ?? []).map((value): [string, string] => [value, value]),
  ]
}
