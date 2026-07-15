import React, { createContext, useContext } from "react";
import { type Whoami } from "./api";

/** The signed-in identity, provided once at the root (no prop drilling). */
const SessionContext = createContext<Whoami | null>(null);
export const SessionProvider = SessionContext.Provider;
export function useMe(): Whoami {
  const me = useContext(SessionContext);
  if (!me) throw new Error("useMe outside SessionProvider");
  return me;
}
