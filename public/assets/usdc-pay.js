/**
 * Base mainnet USDC transfer helpers for injected wallets (MetaMask).
 * Harbor Café pattern — `to` must be the USDC contract, never the payout wallet.
 */
(() => {
  const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const BASE_CHAIN_ID = "0x2105";
  const USDC_DECIMALS = 6;
  const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
  const AMOUNT_RE = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

  function isAddress(value) {
    return typeof value === "string" && ADDR_RE.test(value);
  }

  function normalizeAddress(value) {
    if (!isAddress(value)) throw new Error("Invalid Ethereum address");
    return value.toLowerCase();
  }

  function toUsdcUnits(amount) {
    const raw = typeof amount === "number" ? String(amount) : String(amount ?? "").trim();
    if (!AMOUNT_RE.test(raw)) throw new Error("Invalid USDC amount");
    const [whole, frac = ""] = raw.split(".");
    const frac6 = (frac + "000000").slice(0, 6);
    return BigInt(whole || "0") * 10n ** BigInt(USDC_DECIMALS) + BigInt(frac6);
  }

  function encodeErc20Transfer(to, units) {
    const addr = normalizeAddress(to).replace(/^0x/, "").padStart(64, "0");
    if (typeof units !== "bigint" || units < 0n) throw new Error("Invalid transfer units");
    return "0xa9059cbb" + addr + units.toString(16).padStart(64, "0");
  }

  function buildUsdcTransferTx({ from, recipient, amount, usdc = USDC_BASE }) {
    if (!isAddress(from)) throw new Error("Invalid wallet address");
    if (!isAddress(recipient)) throw new Error("Invalid payment recipient address");
    const fromAddr = normalizeAddress(from);
    const recipientAddr = normalizeAddress(recipient);
    if (fromAddr === recipientAddr) {
      throw new Error(
        "Connected wallet is the band payout account (same account). Switch MetaMask to a different account that holds USDC, then try again.",
      );
    }
    const units = toUsdcUnits(amount);
    if (units <= 0n) throw new Error("Invalid USDC amount");
    return {
      from: fromAddr,
      to: usdc,
      value: "0x0",
      data: encodeErc20Transfer(recipientAddr, units),
      chainId: BASE_CHAIN_ID,
    };
  }

  const USDC_WATCH_ASSET = {
    type: "ERC20",
    options: {
      address: USDC_BASE,
      symbol: "USDC",
      decimals: USDC_DECIMALS,
      image: "https://assets.coingecko.com/coins/images/6319/small/usdc.png",
    },
  };

  async function payWithInjectedWallet({ recipient, amount }) {
    const eth = window.ethereum;
    if (!eth) throw new Error("NO_WALLET");

    const accounts = await eth.request({ method: "eth_requestAccounts" });
    const from = accounts?.[0];
    if (!from) throw new Error("No account");

    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: BASE_CHAIN_ID }],
      });
    } catch (err) {
      if (err?.code === 4902) {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: BASE_CHAIN_ID,
              chainName: "Base",
              nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
              rpcUrls: ["https://mainnet.base.org"],
              blockExplorerUrls: ["https://basescan.org"],
            },
          ],
        });
      } else {
        throw err;
      }
    }

    try {
      await eth.request({ method: "wallet_watchAsset", params: USDC_WATCH_ASSET });
    } catch {
      /* optional */
    }

    const tx = buildUsdcTransferTx({ from, recipient, amount });
    return eth.request({ method: "eth_sendTransaction", params: [tx] });
  }

  window.AxShopPay = {
    USDC_BASE,
    BASE_CHAIN_ID,
    USDC_WATCH_ASSET,
    buildUsdcTransferTx,
    payWithInjectedWallet,
    isAddress,
  };
})();
