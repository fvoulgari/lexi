import { createContext, useContext } from "react";
export const AccountContext = createContext(null);
export function useAccount() {
  return useContext(AccountContext);
}
