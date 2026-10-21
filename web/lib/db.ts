export type Result = Promise<{ data: unknown; error: unknown }>;

export async function unwrap<T>(r: Result, what: string): Promise<T> {
  const { data, error } = await r;
  if (error || !Array.isArray(data)) throw new Error(`lecture de ${what} impossible`);
  return data as T;
}
