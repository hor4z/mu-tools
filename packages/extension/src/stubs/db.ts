/** En la página no hay base de datos: el núcleo del bot (src/bot) usa esto en lugar de la base de mutbot. No hace nada ni sale a ninguna red. */
export const dbOn = () => false;
export const dbRows = async <T = Record<string, unknown>>(_sql: string, _timeoutMs?: number): Promise<T[]> => [];
export const dbInsert = async (_table: string, _rows: object[], _timeoutMs?: number): Promise<void> => {};
export const readDirectives = async (): Promise<Record<string, boolean | number>> => ({});
export const writeDirective = async (_k: string, _v: boolean | number): Promise<void> => {};
export const deleteDirective = async (_k: string): Promise<void> => {};
export const readSettings = async (): Promise<Record<string, string>> => ({});
export const writeSetting = async (_k: string, _v: string): Promise<void> => {};
export const readCharacter = async (): Promise<null> => null;
export const writeCharacter = async (_c: unknown): Promise<void> => {};
