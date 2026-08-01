/** One translatable string. BOTH halves are required, which is what makes an
 *  untranslated string a compile error rather than something a reviewer has to
 *  notice — the owner's "whatever changes you make impact both languages", in the
 *  type system. */
export type Entry = { en: string; ar: string };
