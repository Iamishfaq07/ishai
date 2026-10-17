// The question bank's virtual modules (apps/web/questionBank.ts).
declare module "virtual:question-bank/names" {
  export const companyNames: Record<string, string>;
  export const roleNames: Record<string, string>;
}

declare module "virtual:question-bank/cards" {
  import type { BankCard } from "./pages/bank/types";
  export const companies: BankCard[];
  export const roles: BankCard[];
}

declare module "virtual:question-bank/docs" {
  import type { BankCompany, BankRole } from "./pages/bank/types";
  export const companyDocs: Record<string, () => Promise<{ default: BankCompany }>>;
  export const roleDocs: Record<string, () => Promise<{ default: BankRole }>>;
}
