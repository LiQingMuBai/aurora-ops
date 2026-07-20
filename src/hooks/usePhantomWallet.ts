import { useCallback, useMemo, useState } from 'react';
import type { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';

// Phantom 连接成功后，最关键的数据就是当前钱包公钥。
type PhantomConnectResponse = {
  publicKey: PublicKey;
};

// 这里抽出一个最小 Phantom Provider 类型，避免页面到处写 any。
type PhantomProvider = {
  isPhantom?: boolean;
  publicKey?: PublicKey | null;
  connect: (options?: { onlyIfTrusted?: boolean }) => Promise<PhantomConnectResponse>;
  disconnect: () => Promise<void>;
  signTransaction: (transaction: Transaction | VersionedTransaction) => Promise<Transaction>;
};

// 把浏览器注入的钱包对象挂到 Window 类型上，便于 TypeScript 正确推断。
declare global {
  interface Window {
    solana?: PhantomProvider;
  }
}

export function usePhantomWallet() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);

  // 只在浏览器环境且检测到 Phantom 时暴露 provider，SSR 或未安装钱包时返回 null。
  const provider = useMemo(() => {
    if (typeof window === 'undefined' || !window.solana?.isPhantom) {
      return null;
    }

    return window.solana;
  }, []);

  // 发起钱包连接，并把当前地址同步到 React 状态中。
  const connect = useCallback(async () => {
    if (!provider) {
      throw new Error('未检测到 Phantom 钱包');
    }

    const response = await provider.connect();
    const address = response.publicKey.toBase58();
    setWalletAddress(address);
    return address;
  }, [provider]);

  // 断开当前钱包连接，同时清理本地保存的钱包地址。
  const disconnect = useCallback(async () => {
    if (!provider) {
      return;
    }

    await provider.disconnect();
    setWalletAddress(null);
  }, [provider]);

  return {
    provider,
    walletAddress,
    setWalletAddress,
    connect,
    disconnect,
  };
}
