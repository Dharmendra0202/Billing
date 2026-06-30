/// <reference types="vite/client" />

interface Window {
  billDesktop?: {
    openImage: () => Promise<string | null>;
    printBill: () => Promise<boolean>;
  };
}
